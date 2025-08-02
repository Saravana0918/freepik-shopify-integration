require('dotenv').config();
const express = require('express');
const axios = require('axios');
const cors = require('cors');
const path = require('path');
const crypto = require('crypto');

const app = express();
const PORT = process.env.PORT || 5000;

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

app.use((req, res, next) => {
  res.setHeader('Content-Security-Policy', "frame-ancestors https://*.myshopify.com https://admin.shopify.com");
  res.setHeader('Access-Control-Allow-Origin', '*');
  next();
});

// Freepik image search
app.get('/api/search', async (req, res) => {
  const term = req.query.term || 'jersey';
  const page = req.query.page || 1;
  try {
    const response = await axios.get(
      `https://api.freepik.com/v1/resources?order=relevance&limit=60&page=${page}&term=${encodeURIComponent(term)}`,
      { headers: { 'x-freepik-api-key': process.env.FREEPIK_API_KEY } }
    );
    res.json(response.data);
  } catch (error) {
    res.status(500).json({ error: 'Freepik API error', detail: error.response?.data || error.message });
  }
});

app.post('/api/add-to-shopify', async (req, res) => {
  const { title, imageUrl } = req.body;

  try {
    // Step 1: Fetch all products tagged as "freepik-imported"
    const productsRes = await axios.get(
      `https://${process.env.SHOPIFY_STORE}.myshopify.com/admin/api/2023-10/products.json?limit=250&fields=id,title,tags`,
      {
        headers: {
          'X-Shopify-Access-Token': process.env.SHOPIFY_API_PASSWORD
        }
      }
    );

    const products = productsRes.data.products || [];

    // Step 2: Loop through each product and check their metafields
    for (const product of products) {
      // Only check Freepik-tagged products
      if (!product.tags.includes('freepik-imported')) continue;

      const metafieldsRes = await axios.get(
        `https://${process.env.SHOPIFY_STORE}.myshopify.com/admin/api/2023-10/products/${product.id}/metafields.json`,
        {
          headers: {
            'X-Shopify-Access-Token': process.env.SHOPIFY_API_PASSWORD
          }
        }
      );

      const match = metafieldsRes.data.metafields.find(
        m => m.namespace === 'freepik' && m.key === 'image_url' && m.value === imageUrl
      );

      if (match) {
        // ❌ Duplicate found
        return res.json({ status: 'duplicate', message: '❌ Already exists in Shopify' });
      }
    }

    // Step 3: No duplicate → create new product
    await axios.post(
      `https://${process.env.SHOPIFY_STORE}.myshopify.com/admin/api/2023-10/products.json`,
      {
        product: {
          title,
          status: "active",
          images: [{ src: imageUrl }],
          tags: "freepik-imported",
          metafields: [
            {
              namespace: "freepik",
              key: "image_url",
              type: "single_line_text_field",
              value: imageUrl
            }
          ]
        }
      },
      {
        headers: {
          'X-Shopify-Access-Token': process.env.SHOPIFY_API_PASSWORD,
          'Content-Type': 'application/json'
        }
      }
    );

    // ✅ Success
    res.json({ status: 'added', message: '✅ Product added to Shopify' });

  } catch (error) {
    console.error('❌ Shopify API error:', error.response?.data || error.message);
    res.status(500).json({
      status: 'error',
      message: '❌ Failed to add product',
      error: error.response?.data || error.message
    });
  }
});



// OAuth install
app.get('/api/auth', (req, res) => {
  const shop = req.query.shop;
  if (!shop) return res.status(400).send('Missing shop parameter');

  const redirectUrl = `https://${shop}/admin/oauth/authorize` +
    `?client_id=${process.env.SHOPIFY_API_KEY}` +
    `&scope=read_products,write_products` +
    `&redirect_uri=${process.env.REDIRECT_URI}`;

  res.redirect(redirectUrl);
});

// OAuth callback
app.get('/api/auth/callback', async (req, res) => {
  const { shop, hmac, code } = req.query;
  if (!shop || !hmac || !code) {
    return res.status(400).send('Missing required parameters');
  }

  const params = { ...req.query };
  delete params.hmac;
  const message = Object.keys(params).sort().map(key => `${key}=${params[key]}`).join('&');

  const generatedHash = crypto
    .createHmac('sha256', process.env.SHOPIFY_API_SECRET)
    .update(message)
    .digest('hex');

  if (generatedHash !== hmac) {
    return res.status(400).send('HMAC validation failed');
  }

  try {
    const tokenRes = await axios.post(`https://${shop}/admin/oauth/access_token`, {
      client_id: process.env.SHOPIFY_API_KEY,
      client_secret: process.env.SHOPIFY_API_SECRET,
      code
    });

    const accessToken = tokenRes.data.access_token;
    console.log("✅ App installed! Access Token:", accessToken);
    res.send("✅ App installed successfully. You can close this tab.");
  } catch (error) {
    res.status(500).send("OAuth process failed");
  }
});

// Serve frontend
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, () => {
  console.log(`✅ Server is running at http://localhost:${PORT}`);
});
