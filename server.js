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

// ✅ Generate short hash for image URL
function hashImageUrl(url) {
  return 'fpimg-' + crypto.createHash('md5').update(url).digest('hex');
}

// ✅ Route: Search Freepik & Detect Shopify Duplicates
app.get('/api/search', async (req, res) => {
  const term = req.query.term || 'jersey';
  const page = req.query.page || 1;

  try {
    // ✅ 1. Freepik search
    const freepikRes = await axios.get(
      `https://api.freepik.com/v1/resources?term=${encodeURIComponent(term)}&order=relevance&limit=60&page=${page}`,
      {
        headers: {
          'x-freepik-api-key': process.env.FREEPIK_API_KEY
        }
      }
    );

    const freepikData = freepikRes.data?.data || [];

    // ✅ 2. Collect Shopify products' tags
    let existingHashTags = new Set();
    let shopifyUrl = `https://${process.env.SHOPIFY_STORE}/admin/api/2023-10/products.json?limit=250&fields=id,tags`;
    let pageCount = 0;

    while (shopifyUrl && pageCount < 5) {
      const shopifyRes = await axios.get(shopifyUrl, {
        headers: {
          'X-Shopify-Access-Token': process.env.SHOPIFY_API_PASSWORD
        }
      });

      const products = shopifyRes.data.products || [];

      for (const product of products) {
        const tags = product.tags?.split(',') || [];
        tags.forEach(tag => {
          const cleaned = tag.trim();
          if (cleaned.startsWith('fpimg-')) {
            existingHashTags.add(cleaned);
          }
        });
      }

      // Pagination logic
      const linkHeader = shopifyRes.headers.link;
      const nextLink = linkHeader?.match(/<([^>]+)>;\s*rel="next"/);
      shopifyUrl = nextLink ? nextLink[1] : null;
      pageCount++;
    }

    // ✅ 3. Compare and mark duplicates
    const resultsWithStatus = freepikData.map(item => {
      const imageUrl = item?.image?.source?.url;
      const hashTag = hashImageUrl(imageUrl);
      return {
        ...item,
        duplicate: existingHashTags.has(hashTag)
      };
    });

    res.json({ data: resultsWithStatus });

  } catch (error) {
    console.error('❌ /api/search error:', error.response?.data || error.message);
    res.status(500).json({ error: 'Freepik or Shopify API failed' });
  }
});


// ✅ Route: Add product to Shopify and tag with image hash
app.post('/api/add-to-shopify', async (req, res) => {
  let { title, imageUrl } = req.body;

  if (!title || title.trim() === '') {
    title = 'Freepik Imported Product';
  }

  const hashTag = hashImageUrl(imageUrl);

  try {
    await axios.post(
      `https://${process.env.SHOPIFY_STORE}.myshopify.com/admin/api/2023-10/products.json`,
      {
        product: {
          title,
          status: "active",
          images: [{ src: imageUrl }],
          tags: `freepik-imported,${hashTag}`
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

// (Optional) Shopify OAuth install
app.get('/api/auth', (req, res) => {
  const shop = req.query.shop;
  if (!shop) return res.status(400).send('Missing shop parameter');

  const redirectUrl = `https://${shop}/admin/oauth/authorize` +
    `?client_id=${process.env.SHOPIFY_API_KEY}` +
    `&scope=read_products,write_products` +
    `&redirect_uri=${process.env.REDIRECT_URI}`;

  res.redirect(redirectUrl);
});

// Serve index.html
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, () => {
  console.log(`✅ Server running on http://localhost:${PORT}`);
});
