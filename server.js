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

// 🔐 Utility to generate short hash for Freepik image URL
function getShortHash(imageUrl) {
  const fullHash = crypto.createHash('sha1').update(imageUrl).digest('hex');
  return `fpimg-${fullHash.slice(0, 6)}`;
}

// ✅ Freepik image search
app.get('/api/search', async (req, res) => {
  const term = req.query.term || 'jersey';
  const page = req.query.page || 1;

  try {
    const response = await axios.get(
      `https://api.freepik.com/v1/resources?order=relevance&limit=60&page=${page}&term=${encodeURIComponent(term)}`,
      {
        headers: {
          'x-freepik-api-key': process.env.FREEPIK_API_KEY
        }
      }
    );
    res.json(response.data);
  } catch (error) {
    console.error("❌ Freepik error:", error.response?.data || error.message);
    res.status(500).json({
      error: "Freepik API error",
      detail: error.response?.data || error.message
    });
  }
});


// ✅ Add product to Shopify with hash tag
// ✅ Add product to Shopify with variants (sizes + price + qty)
// ✅ Add product to Shopify with variants (sizes + price + qty + pricing tag)
app.post('/api/add-to-shopify', async (req, res) => {
  const { title, imageUrl, priceTag } = req.body; 
  // priceTag = "299-399" OR "499-599" OR "699-799"

  try {
    // 🔑 generate hash tag to track duplicates
    const hashTag = getShortHash(imageUrl);

    // ✅ price scheme logic
    let normalPrice = 299;
    let bigPrice = 399;

    if (priceTag === "499-599") {
      normalPrice = 499;
      bigPrice = 599;
    } else if (priceTag === "699-799") {
      normalPrice = 699;
      bigPrice = 799;
    }

    // ✅ sizes
    const sizes = ["XS", "S", "M", "L", "XL", "2XL", "3XL"];

    // ✅ variants (with same stock = 100 for all)
    const variants = sizes.map(size => ({
      option1: size,
      price: size === "3XL" ? bigPrice.toString() : normalPrice.toString(),
      sku: `JERSEY-${size}`,
      inventory_management: "shopify",
      inventory_quantity: 100
    }));

    // ✅ full product data
    const productData = {
      product: {
        title,
        body_html: "Imported from Freepik – Premium Sports Jersey.",
        vendor: "Next Print",
        product_type: "T-Shirts",       
        custom_product_type: "Jerseys",
        status: "active",
        
        // ✅ tags: pricing scheme + freepik + hash
        tags: `freepik-imported,pricing:${priceTag},${hashTag}`,

        options: [
          {
            name: "Size",
            values: sizes
          }
        ],

        variants,
        images: [{ src: imageUrl }],
        metafields: [
          {
            namespace: "freepik",
            key: "image_url",
            type: "single_line_text_field",
            value: imageUrl
          }
        ]
      }
    };

    // ✅ Shopify API call
    await axios.post(
      `https://${process.env.SHOPIFY_STORE}.myshopify.com/admin/api/2023-10/products.json`,
      productData,
      {
        headers: {
          'X-Shopify-Access-Token': process.env.SHOPIFY_API_PASSWORD,
          'Content-Type': 'application/json'
        }
      }
    );

    res.json({ success: true, message: '✅ Product with sizes & price added to Shopify.' });

  } catch (error) {
    console.error('Shopify API error:', error.response?.data || error.message);
    res.status(500).json({
      success: false,
      message: '❌ Failed to add product',
      error: error.response?.data || error.message
    });
  }
});



// ✅ Return all existing hash tags from Shopify products
app.get('/api/shopify-hashes', async (req, res) => {
  try {
    const allHashes = [];
    let endpoint = `https://${process.env.SHOPIFY_STORE}.myshopify.com/admin/api/2023-10/products.json?limit=250`;
    let hasNextPage = true;

    while (hasNextPage) {
      const response = await axios.get(endpoint, {
        headers: {
          'X-Shopify-Access-Token': process.env.SHOPIFY_API_PASSWORD
        }
      });

      const products = response.data.products || [];
      products.forEach(product => {
        const tags = product.tags.split(',').map(t => t.trim());
        tags.forEach(tag => {
          if (tag.startsWith("fpimg-")) {
            allHashes.push(tag);
          }
        });
      });

      const linkHeader = response.headers.link;
      if (linkHeader && linkHeader.includes('rel="next"')) {
        const match = linkHeader.match(/<([^>]+)>;\s*rel="next"/);
        if (match) {
          endpoint = match[1];
        } else {
          hasNextPage = false;
        }
      } else {
        hasNextPage = false;
      }
    }

    res.json({ hashes: allHashes });
  } catch (error) {
    console.error('Error fetching Shopify products:', error.message);
    res.status(500).json({ hashes: [] });
  }
});

// ✅ OAuth install
app.get('/api/auth', (req, res) => {
  const shop = req.query.shop;
  if (!shop) return res.status(400).send('Missing shop parameter');

  const redirectUrl = `https://${shop}/admin/oauth/authorize` +
    `?client_id=${process.env.SHOPIFY_API_KEY}` +
    `&scope=read_products,write_products` +
    `&redirect_uri=${process.env.REDIRECT_URI}`;

  res.redirect(redirectUrl);
});

// ✅ OAuth callback
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

// ✅ Serve frontend
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, () => {
  console.log(`✅ Server is running at http://localhost:${PORT}`);
});
