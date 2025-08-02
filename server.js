require('dotenv').config();
const express = require('express');
const axios = require('axios');
const cors = require('cors');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 5000;

// 🔐 Use values from .env
const shopifyStore = process.env.SHOPIFY_STORE;
const SHOPIFY_ADMIN_API_TOKEN = process.env.SHOPIFY_API_PASSWORD;
const FREEPIK_API_KEY = process.env.FREEPIK_API_KEY;

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Security headers
app.use((req, res, next) => {
  res.setHeader('Content-Security-Policy', "frame-ancestors https://*.myshopify.com https://admin.shopify.com");
  res.setHeader('Access-Control-Allow-Origin', '*');
  next();
});

// 🔐 Generate short Freepik image hash
function getShortHash(url) {
  return 'fpimg-' + Buffer.from(url).toString('base64').substring(0, 20).toLowerCase().replace(/[^a-z0-9]/g, '');
}

// ✅ Create new Shopify product with Freepik image and save metafields
app.post('/api/add-to-shopify', async (req, res) => {
  const { images } = req.body;

  try {
    for (const image of images) {
      const shortHash = getShortHash(image.url);

      const productRes = await axios.post(`https://${shopifyStore}/admin/api/2023-10/products.json`, {
        product: {
          title: image.title,
          images: [{ src: image.url }],
          tags: ['freepik-imported']
        }
      }, {
        headers: {
          'X-Shopify-Access-Token': SHOPIFY_ADMIN_API_TOKEN,
          'Content-Type': 'application/json'
        }
      });

      const productId = productRes.data.product.id;

      const metafields = [
        {
          namespace: 'freepik',
          key: 'image_hash',
          value: shortHash,
          type: 'single_line_text_field'
        },
        {
          namespace: 'freepik',
          key: 'image_url',
          value: image.url,
          type: 'url'
        }
      ];

      for (const mf of metafields) {
        await axios.post(`https://${shopifyStore}/admin/api/2023-10/products/${productId}/metafields.json`, {
          metafield: mf
        }, {
          headers: {
            'X-Shopify-Access-Token': SHOPIFY_ADMIN_API_TOKEN,
            'Content-Type': 'application/json'
          }
        });
      }
    }

    res.json({ message: '✅ All products added to Shopify successfully.' });
  } catch (err) {
    console.error("❌ Error importing to Shopify:", err.message);
    res.status(500).json({ error: 'Failed to import products' });
  }
});

// ✅ Freepik image search
app.get('/api/search', async (req, res) => {
  const term = req.query.query || 'jersey';
  const page = req.query.page || 1;

  try {
    const response = await axios.get(`https://api.freepik.com/v1/resources/search?order=relevance&limit=60&page=${page}&term=${encodeURIComponent(term)}`, {
      headers: {
        'x-freepik-api-key': FREEPIK_API_KEY
      }
    });

    const results = response.data?.data?.map(img => ({
      title: img.title,
      url: img?.image?.source?.url || ''
    })) || [];

    res.json(results);
  } catch (error) {
    console.error('❌ Freepik API error:', error.message);
    res.status(500).json({ error: 'Failed to fetch Freepik images' });
  }
});

// Serve frontend
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, () => {
  console.log(`✅ Server running on http://localhost:${PORT}`);
});
