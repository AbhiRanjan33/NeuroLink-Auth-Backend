// backend/server.js
require('dotenv').config();

const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const multer = require('multer');
const { CloudinaryStorage } = require('multer-storage-cloudinary'); // ← CORRECT
const cloudinary = require('cloudinary').v2;

const app = express();

// Middleware
app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

// --- CLOUDINARY CONFIG ---
cloudinary.config({
  cloud_name: 'drqhllyex',
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

// --- MULTER + CLOUDINARY STORAGE ---
const storage = new CloudinaryStorage({
  cloudinary,
  params: {
    folder: 'neurolink/journals',
    resource_type: 'auto', // image or video
    allowed_formats: ['jpg', 'jpeg', 'png', 'gif', 'mp4', 'mov'],
  },
});

const upload = multer({ storage });

// --- MONGO DB ---
mongoose.connect(process.env.MONGODB_URI)
  .then(() => console.log('MongoDB Connected'))
  .catch(err => console.error('MongoDB Error:', err));

// --- USER SCHEMA ---
const userSchema = new mongoose.Schema({
  fingerprintId: { type: String, required: true, unique: true },
  userId: { type: String, required: true, unique: true },
  name: String,
  email: { type: String, unique: true, sparse: true },
  journals: [{
    text: String,
    mediaUrl: String,
    caption: String,
    timestamp: { type: Date, default: Date.now },
  }],
});

const User = mongoose.model('User', userSchema);

// --- ROUTES ---

// AUTH
app.post('/auth', async (req, res) => {
  const { fingerprintId } = req.body;
  try {
    let user = await User.findOne({ fingerprintId });
    if (user) {
      return res.json({
        success: true,
        user: {
          name: user.name,
          email: user.email,
          userId: user.userId,
          fingerprintId: user.fingerprintId,
          journals: user.journals,
        },
      });
    }

    const userId = `user_${fingerprintId}`;
    user = new User({ fingerprintId, userId });
    await user.save();

    res.json({ success: true, newUser: true, userId });
  } catch (err) {
    if (err.code === 11000) {
      return res.status(400).json({ success: false, error: 'Fingerprint already registered' });
    }
    res.status(500).json({ success: false, error: err.message });
  }
});

// SAVE PROFILE
app.post('/save-profile', async (req, res) => {
  const { fingerprintId, name, email } = req.body;
  try {
    const existing = await User.findOne({ email, fingerprintId: { $ne: fingerprintId } });
    if (existing) {
      return res.status(400).json({ success: false, error: 'Email already in use' });
    }

    const updated = await User.findOneAndUpdate(
      { fingerprintId },
      { name, email },
      { new: true }
    );

    res.json({
      success: true,
      user: {
        name: updated.name,
        email: updated.email,
        userId: updated.userId,
        fingerprintId: updated.fingerprintId,
        journals: updated.journals,
      },
    });
  } catch (err) {
    if (err.code === 11000) {
      return res.status(400).json({ success: false, error: 'Email already in use' });
    }
    res.status(500).json({ success: false, error: err.message });
  }
});

// UPLOAD MEDIA
app.post('/upload-media', upload.single('file'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ success: false, error: 'No file uploaded' });
    }

    res.json({
      success: true,
      url: req.file.path,        // Cloudinary URL
      public_id: req.file.filename,
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// SAVE JOURNAL
app.post('/save-journal', async (req, res) => {
  const { userId, text, mediaUrl, caption } = req.body;

  try {
    const journalEntry = {
      text: text || '',
      timestamp: new Date(),
    };

    if (mediaUrl) {
      journalEntry.mediaUrl = mediaUrl;
      journalEntry.caption = caption || '';
    }

    const user = await User.findOneAndUpdate(
      { userId },
      { $push: { journals: journalEntry } },
      { new: true }
    );

    if (!user) {
      return res.status(404).json({ success: false, error: 'User not found' });
    }

    res.json({
      success: true,
      journals: user.journals,
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// HEALTH
app.get('/', (req, res) => res.send('NeuroLink Backend OK'));

// START
const PORT = process.env.PORT || 5000;
app.listen(PORT, () => console.log(`Server on port ${PORT}`));