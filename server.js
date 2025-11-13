// backend/server.js
const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');

const app = express();
app.use(cors());
app.use(express.json());

mongoose.connect(
  'mongodb+srv://ranjanabhi2468_db_user:5IkHfpx60WlHYRQa@cluster0.xc3da1w.mongodb.net/neurolink?retryWrites=true&w=majority'
)
  .then(() => console.log('MongoDB Connected'))
  .catch(err => console.error(err));

// USER SCHEMA — email must be unique
const userSchema = new mongoose.Schema({
  fingerprintId: { type: String, required: true, unique: true },
  userId: { type: String, required: true, unique: true },
  name: String,
  email: { type: String, unique: true, sparse: true }, // sparse = allow null
});

const User = mongoose.model('User', userSchema);

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

// SAVE PROFILE — CHECK EMAIL UNIQUENESS
app.post('/save-profile', async (req, res) => {
  const { fingerprintId, name, email } = req.body;
  try {
    // Check if email already used by another fingerprint
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
      },
    });
  } catch (err) {
    if (err.code === 11000) {
      return res.status(400).json({ success: false, error: 'Email already in use' });
    }
    res.status(500).json({ success: false, error: err.message });
  }
});

app.get('/', (req, res) => res.send('NeuroLink Backend OK'));

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => console.log(`Server on port ${PORT}`));