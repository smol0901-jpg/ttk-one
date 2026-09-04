const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');

const JWT_SECRET = process.env.JWT_SECRET || 'ttk-professional-secret-key-2024';
const JWT_EXPIRY = '24h';

const authMiddleware = (db) => {
  return {
    // Authenticate user
    authenticate: (req, res, next) => {
      try {
        const authHeader = req.headers.authorization;
        if (!authHeader || !authHeader.startsWith('Bearer ')) {
          // Check for guest access
          const username = req.query.username || req.body.username;
          if (username === 'guest') {
            const guestUser = db.prepare('SELECT * FROM users WHERE username = ? AND role = ?').get('guest', 'guest');
            if (guestUser) {
              req.user = guestUser;
              return next();
            }
          }
          return res.status(401).json({ error: 'Authentication required' });
        }

        const token = authHeader.split(' ')[1];
        const decoded = jwt.verify(token, JWT_SECRET);
        
        const user = db.prepare('SELECT * FROM users WHERE id = ? AND is_active = 1').get(decoded.userId);
        if (!user) {
          return res.status(401).json({ error: 'User not found or inactive' });
        }

        req.user = user;
        next();
      } catch (error) {
        return res.status(401).json({ error: 'Invalid or expired token' });
      }
    },

    // Role-based authorization
    requireRole: (...roles) => {
      return (req, res, next) => {
        if (!req.user) {
          return res.status(401).json({ error: 'Authentication required' });
        }

        if (!roles.includes(req.user.role)) {
          return res.status(403).json({ error: 'Insufficient permissions' });
        }

        next();
      };
    },

    // Login handler
    login: (req, res) => {
      try {
        const { username, password } = req.body;

        if (!username) {
          return res.status(400).json({ error: 'Username required' });
        }

        // Guest access without password
        if (username === 'guest') {
          const guestUser = db.prepare('SELECT * FROM users WHERE username = ? AND role = ? AND is_active = 1').get('guest', 'guest');
          if (guestUser) {
            const token = jwt.sign({ userId: guestUser.id, role: guestUser.role }, JWT_SECRET, { expiresIn: JWT_EXPIRY });
            
            db.prepare('UPDATE users SET last_login = CURRENT_TIMESTAMP WHERE id = ?').run(guestUser.id);
            
            return res.json({
              token,
              user: {
                id: guestUser.id,
                username: guestUser.username,
                role: guestUser.role,
                fullName: guestUser.full_name
              }
            });
          }
          return res.status(401).json({ error: 'Guest account not available' });
        }

        const user = db.prepare('SELECT * FROM users WHERE username = ? AND is_active = 1').get(username);
        if (!user) {
          return res.status(401).json({ error: 'Invalid credentials' });
        }

        if (!bcrypt.compareSync(password, user.password_hash)) {
          return res.status(401).json({ error: 'Invalid credentials' });
        }

        const token = jwt.sign({ userId: user.id, role: user.role }, JWT_SECRET, { expiresIn: JWT_EXPIRY });
        
        db.prepare('UPDATE users SET last_login = CURRENT_TIMESTAMP WHERE id = ?').run(user.id);

        res.json({
          token,
          user: {
            id: user.id,
            username: user.username,
            role: user.role,
            fullName: user.full_name,
            avatar: user.avatar,
            department: user.department
          }
        });
      } catch (error) {
        res.status(500).json({ error: 'Login failed', details: error.message });
      }
    },

    // Register new user (admin only)
    register: (req, res) => {
      try {
        const { username, password, role, fullName, department } = req.body;

        if (req.user.role !== 'admin') {
          return res.status(403).json({ error: 'Only admins can create users' });
        }

        if (!username || !password) {
          return res.status(400).json({ error: 'Username and password required' });
        }

        const existingUser = db.prepare('SELECT id FROM users WHERE username = ?').get(username);
        if (existingUser) {
          return res.status(409).json({ error: 'Username already exists' });
        }

        const passwordHash = bcrypt.hashSync(password, 10);
        const result = db.prepare(`
          INSERT INTO users (username, password_hash, role, full_name, department)
          VALUES (?, ?, ?, ?, ?)
        `).run(username, passwordHash, role || 'operator', fullName, department);

        res.status(201).json({
          message: 'User created successfully',
          userId: result.lastInsertRowid
        });
      } catch (error) {
        res.status(500).json({ error: 'Registration failed', details: error.message });
      }
    },

    // Change password
    changePassword: (req, res) => {
      try {
        const { currentPassword, newPassword } = req.body;
        const userId = req.user.id;

        const user = db.prepare('SELECT * FROM users WHERE id = ?').get(userId);
        if (!bcrypt.compareSync(currentPassword, user.password_hash)) {
          return res.status(401).json({ error: 'Current password is incorrect' });
        }

        const newPasswordHash = bcrypt.hashSync(newPassword, 10);
        db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(newPasswordHash, userId);

        res.json({ message: 'Password changed successfully' });
      } catch (error) {
        res.status(500).json({ error: 'Password change failed', details: error.message });
      }
    },

    // Reset password for another user (admin only)
    resetPassword: (req, res) => {
      try {
        if (req.user.role !== 'admin') {
          return res.status(403).json({ error: 'Only admins can reset passwords' });
        }

        const { userId, newPassword } = req.body;
        const newPasswordHash = bcrypt.hashSync(newPassword, 10);
        
        db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(newPasswordHash, userId);

        res.json({ message: 'Password reset successfully' });
      } catch (error) {
        res.status(500).json({ error: 'Password reset failed', details: error.message });
      }
    },

    // Get current user profile
    getProfile: (req, res) => {
      try {
        const user = db.prepare(`
          SELECT id, username, role, full_name, avatar, department, created_at, last_login, settings
          FROM users WHERE id = ?
        `).get(req.user.id);

        res.json({ user });
      } catch (error) {
        res.status(500).json({ error: 'Failed to get profile', details: error.message });
      }
    },

    // Update user profile
    updateProfile: (req, res) => {
      try {
        const { fullName, avatar, department, settings } = req.body;
        const userId = req.user.id;

        db.prepare(`
          UPDATE users 
          SET full_name = COALESCE(?, full_name),
              avatar = COALESCE(?, avatar),
              department = COALESCE(?, department),
              settings = COALESCE(?, settings)
          WHERE id = ?
        `).run(fullName, avatar, department, JSON.stringify(settings), userId);

        res.json({ message: 'Profile updated successfully' });
      } catch (error) {
        res.status(500).json({ error: 'Profile update failed', details: error.message });
      }
    }
  };
};

module.exports = authMiddleware;
