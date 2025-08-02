require('dotenv').config();
const express = require('express');
const axios = require('axios');
const cors = require('cors');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 5000;

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Allow Shopify iframe access
app.use((req, res, next) => {
  res.setHeader('Content-Security-Policy', "frame-ancestors https://*.myshopify.com https://admin.shopify.com");
  res.setHeader('Access-Control-Allow-Origin', '*');
  next();
});

// ✅ Freepik search with duplicate status
app.get('/api/search', async (req, res) => {
  const term = req.query.term || 'jersey';
  const page = req.query.page || 1;

  try {
    const response = await axios.get(
      `https://api.freepik.com/v1/resources?order=relevance&limit=60&page=${page}&term=${encodeURIComponent(term)}`,
      { headers: { 'x-freepik-api-key': process.env.FREEPIK_API_KEY } }
    );

    const freepikResults = response.data?.data || [];

    const shopifyProductsRes = await axios.get(
      `https://${process.env.SHOPIFY_STORE}.myshopify.com/admin/api/2023-10/products.json?limit=250&fields=id,tags`,
      {
        headers: {
          'X-Shopify-Access-Token': process.env.SHOPIFY_API_PASSWORD
        }
      }
    );

    const existingImageUrls = [];

    for (const product of shopifyProductsRes.data.products || []) {
      if (!product.tags) continue;
      product.tags.split(',').forEach(tag => {
        if (tag.startsWith('http')) {
          existingImageUrls.push(tag.trim());
        }
      });
    }

    const resultsWithStatus = freepikResults.map(item => {
      const imageUrl = item?.image?.source?.url;
      const isDuplicate = existingImageUrls.includes(imageUrl);
      return {
        ...item,
        duplicate: isDuplicate
      };
    });

    res.json({ data: resultsWithStatus });

  } catch (error) {
    console.error('Search API error:', error.response?.data || error.message);
    res.status(500).json({ error: 'Freepik API error' });
  }
});

// ✅ Add product to Shopify with image URL in tag
app.post('/api/add-to-shopify', async (req, res) => {
  let { title, imageUrl } = req.body;
  if (!title || title.trim() === '') {
    title = 'Freepik Imported Product';
  }

  try {
    // Create product with image URL as a tag
    await axios.post(
      `https://${process.env.SHOPIFY_STORE}.myshopify.com/admin/api/2023-10/products.json`,
      {
        product: {
          title,
          status: "active",
          images: [{ src: imageUrl }],
          tags: `freepik-imported,${imageUrl}`
        }
      },
      {
        headers: {
          'X-Shopify-Access-Token': process.env.SHOPIFY_API_PASSWORD,
          'Content-Type': 'application/json'
        }
      }
    );

    res.json({ status: 'added', message: '✅ Product added to Shopify' });

  } catch (error) {
    console.error('Shopify API error:', error.response?.data || error.message);
    res.status(500).json({
      status: 'error',
      message: '❌ Failed to add product',
      error: error.response?.data || error.message
    });
  }
});

// Shopify OAuth (optional)
app.get('/api/auth', (req, res) => {
  const shop = req.query.shop;
  if (!shop) return res.status(400).send('Missing shop parameter');

  const redirectUrl = `https://${shop}/admin/oauth/authorize` +
    `?client_id=${process.env.SHOPIFY_API_KEY}` +
    `&scope=read_products,write_products` +
    `&redirect_uri=${process.env.REDIRECT_URI}`;

  res.redirect(redirectUrl);
});

// Serve frontend
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, () => {
  console.log(`✅ Server running at http://localhost:${PORT}`);
});
