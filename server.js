require('dotenv').config();
const express = require('express');
const axios = require('axios');
const cors = require('cors');
const path = require('path');
const crypto = require('crypto');

const app = express();
const PORT = process.env.PORT || 5000;

const shopifyStore = 'yogireddy.myshopify.com';
const SHOPIFY_ADMIN_API_TOKEN = process.env.SHOPIFY_API_PASSWORD;

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

app.use((req, res, next) => {
  res.setHeader('Content-Security-Policy', "frame-ancestors https://*.myshopify.com https://admin.shopify.com");
  res.setHeader('Access-Control-Allow-Origin', '*');
  next();
});

function getShortHash(url) {
  return 'fpimg-' + Buffer.from(url).toString('base64').substring(0, 20).toLowerCase().replace(/[^a-z0-9]/g, '');
}

// ✅ Shopify metafields API to detect existing image hashes
app.get('/api/shopify-hashes', async (req, res) => {
  try {
    const productRes = await axios.get(`https://${SHOPIFY_STORE}/admin/api/2023-10/products.json?limit=250&fields=id`, {
      headers: {
        'X-Shopify-Access-Token': SHOPIFY_ADMIN_API_TOKEN
      }
    });

    const productIds = productRes.data.products.map(p => p.id);
    const hashes = [];

    for (const id of productIds) {
      const metafieldsRes = await axios.get(`https://${SHOPIFY_STORE}/admin/api/2023-10/products/${id}/metafields.json`, {
        headers: {
          'X-Shopify-Access-Token': SHOPIFY_ADMIN_API_TOKEN
        }
      });

      metafieldsRes.data.metafields.forEach(meta => {
        if (meta.namespace === 'freepik' && meta.key === 'image_hash' && meta.value.startsWith('fpimg-')) {
          hashes.push(meta.value);
        }
      });
    }

    res.json(hashes);
  } catch (error) {
    console.error("Error fetching Shopify metafields:", error.message);
    res.status(500).json({ error: 'Failed to fetch metafields' });
  }
});

// ✅ Add new products and save metafields
app.post('/api/add-to-shopify', async (req, res) => {
  const { images } = req.body;

  try {
    for (const image of images) {
      const shortHash = getShortHash(image.url);

      const productRes = await axios.post(`https://${SHOPIFY_STORE}/admin/api/2023-10/products.json`, {
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
        await axios.post(`https://${SHOPIFY_STORE}/admin/api/2023-10/products/${productId}/metafields.json`, {
          metafield: mf
        }, {
          headers: {
            'X-Shopify-Access-Token': SHOPIFY_ADMIN_API_TOKEN,
            'Content-Type': 'application/json'
          }
        });
      }
    }

    res.json({ message: 'All products added successfully.' });
  } catch (err) {
    console.error("Error importing images:", err.message);
    res.status(500).json({ error: 'Failed to import images' });
  }
});

// Optional Freepik image search proxy (depends on your setup)
app.get('/api/search', async (req, res) => {
  const term = req.query.query || 'jersey';
  const page = req.query.page || 1;

  try {
    const response = await axios.get(`https://api.freepik.com/v1/resources?order=relevance&limit=60&page=${page}&term=${encodeURIComponent(term)}`, {
      headers: {
        'x-freepik-api-key': process.env.FREEPIK_API_KEY
      }
    });

    const results = response.data?.data?.map(img => ({
      title: img.title,
      url: img?.image?.source?.url || ''
    })) || [];

    res.json(results);
  } catch (error) {
    console.error('❌ Freepik API error:', error.message);
    res.status(500).json({ error: 'Failed to search Freepik images' });
  }
});

// Serve index.html
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, () => {
  console.log(`✅ Server running on http://localhost:${PORT}`);
});
