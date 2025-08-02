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

// 🔍 Freepik image search API
app.get('/api/search', async (req, res) => {
  const term = req.query.term || 'jersey';
  const page = req.query.page || 1;
  try {
    const response = await axios.get(
      `https://api.freepik.com/v1/resources/search?order=relevance&limit=60&page=${page}&term=${encodeURIComponent(term)}`,
      { headers: { 'x-freepik-api-key': process.env.FREEPIK_API_KEY } }
    );
    res.json(response.data);
  } catch (error) {
    res.status(500).json({ error: 'Freepik API error', detail: error.response?.data || error.message });
  }
});

// ✅ Add selected image as product in Shopify
app.post('/api/add-to-shopify', async (req, res) => {
  const { title, imageUrl } = req.body;

  try {
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
              namespace: "custom",
              key: "freepik.image_url",
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

    res.json({ success: true, message: '✅ Product added to Shopify.' });

  } catch (error) {
    console.error('Shopify API error:', error.response?.data || error.message);
    res.status(500).json({
      success: false,
      message: '❌ Failed to add product',
      error: error.response?.data || error.message
    });
  }
});

// ✅ Metafield-based hash list for frontend duplicate detection
app.get("/api/shopify-hashes", async (req, res) => {
  try {
    const productRes = await axios.get(
      `https://${process.env.SHOPIFY_STORE}.myshopify.com/admin/api/2023-10/products.json?fields=id,title`,
      {
        headers: {
          "X-Shopify-Access-Token": process.env.SHOPIFY_API_PASSWORD,
          "Content-Type": "application/json"
        }
      }
    );

    const products = productRes.data.products || [];
    const hashes = [];

    for (const product of products) {
      const { id } = product;

      try {
        const metafieldsRes = await axios.get(
          `https://${process.env.SHOPIFY_STORE}.myshopify.com/admin/api/2023-10/products/${id}/metafields.json`,
          {
            headers: {
              "X-Shopify-Access-Token": process.env.SHOPIFY_API_PASSWORD,
              "Content-Type": "application/json"
            }
          }
        );

        const metafields = metafieldsRes.data.metafields || [];
        const match = metafields.find(
          mf => mf.key === "freepik.image_url" && typeof mf.value === "string"
        );

        if (match?.value) {
          const hash = crypto.createHash("md5").update(match.value).digest("hex").slice(0, 8);
          const tag = "fpimg-" + hash;
          hashes.push(tag);
        }
      } catch (e) {
        console.warn(`⚠️ Skipped product ${id}`);
      }
    }

    res.json(hashes);
  } catch (err) {
    console.error("❌ Error in /api/shopify-hashes:", err.message);
    res.status(500).json({ error: "Shopify API failed" });
  }
});

// ✅ Serve frontend
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, () => {
  console.log(`✅ Server running at http://localhost:${PORT}`);
});
