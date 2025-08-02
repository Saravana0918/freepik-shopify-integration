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

// Allow Shopify Admin IFrame
app.use((req, res, next) => {
  res.setHeader('Content-Security-Policy', "frame-ancestors https://*.myshopify.com https://admin.shopify.com");
  res.setHeader('Access-Control-Allow-Origin', '*');
  next();
});

// ✅ Generate consistent short hash for image URL
function hashImageUrl(url) {
  return 'fpimg-' + crypto.createHash('md5').update(url).digest('hex');
}

// ✅ Freepik Search + Shopify Metafield Duplicate Detection
app.get('/api/search', async (req, res) => {
  const term = req.query.term || 'jersey';
  const page = req.query.page || 1;

  try {
    const freepikResponse = await axios.get(
      `https://api.freepik.com/v1/resources?order=relevance&limit=60&page=${page}&term=${encodeURIComponent(term)}`,
      {
        headers: { 'x-freepik-api-key': process.env.FREEPIK_API_KEY }
      }
    );

    const freepikResults = freepikResponse.data?.data || [];

    // ✅ Get all Freepik hashes from Shopify metafields
    let existingHashes = new Set();
    let productsUrl = `https://${process.env.SHOPIFY_STORE}.myshopify.com/admin/api/2023-10/metafields.json?namespace=freepik&key=image_hash&limit=250`;
    let pageCount = 0;

    while (productsUrl && pageCount < 5) {
      const shopifyRes = await axios.get(productsUrl, {
        headers: {
          'X-Shopify-Access-Token': process.env.SHOPIFY_API_PASSWORD
        }
      });

      const metafields = shopifyRes.data.metafields || [];
      metafields.forEach(meta => {
        if (meta.value && typeof meta.value === 'string') {
          existingHashes.add(meta.value);
        }
      });

      const linkHeader = shopifyRes.headers.link;
      if (linkHeader && linkHeader.includes('rel="next"')) {
        const match = linkHeader.match(/<([^>]+)>;\s*rel="next"/);
        productsUrl = match?.[1] || null;
      } else {
        break;
      }

      pageCount++;
    }

    // ✅ Mark duplicate Freepik images
    const resultsWithStatus = freepikResults.map(item => {
      const imageUrl = item?.image?.source?.url;
      const hashTag = hashImageUrl(imageUrl);
      return {
        ...item,
        duplicate: existingHashes.has(hashTag)
      };
    });

    res.json({ data: resultsWithStatus });

  } catch (error) {
    console.error('❌ /api/search error:', error.response?.data || error.message);
    res.status(500).json({ error: 'Freepik API or Shopify API error' });
  }
});

// ✅ Add to Shopify (with Metafield for duplicate detection)
app.post('/api/add-to-shopify', async (req, res) => {
  let { title, imageUrl } = req.body;

  if (!title || title.trim() === '') {
    title = 'Freepik Imported Product';
  }

  const hashTag = hashImageUrl(imageUrl);

  try {
    const productRes = await axios.post(
      `https://${process.env.SHOPIFY_STORE}.myshopify.com/admin/api/2023-10/products.json`,
      {
        product: {
          title,
          status: "active",
          images: [{ src: imageUrl }],
          tags: 'freepik-imported'
        }
      },
      {
        headers: {
          'X-Shopify-Access-Token': process.env.SHOPIFY_API_PASSWORD,
          'Content-Type': 'application/json'
        }
      }
    );

    const productId = productRes.data.product.id;

    // ✅ Attach metafield with image hash
    await axios.post(
      `https://${process.env.SHOPIFY_STORE}.myshopify.com/admin/api/2023-10/metafields.json`,
      {
        metafield: {
          namespace: 'freepik',
          key: 'image_hash',
          value: hashTag,
          type: 'single_line_text_field',
          owner_id: productId,
          owner_resource: 'product'
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
    console.error('❌ /api/add-to-shopify error:', error.response?.data || error.message);
    res.status(500).json({
      status: 'error',
      message: '❌ Failed to add product',
      error: error.response?.data || error.message
    });
  }
});

// Optional OAuth
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
  console.log(`✅ Server running on http://localhost:${PORT}`);
});
