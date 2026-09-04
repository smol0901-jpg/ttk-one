// TTK Professional Server - Frontend Application
(function() {
  'use strict';

  // State
  let token = localStorage.getItem('ttk_token');
  let user = JSON.parse(localStorage.getItem('ttk_user') || 'null');
  let socket = null;
  let charts = {};

  // API Helper
  const api = async (endpoint, options = {}) => {
    const headers = {
      'Content-Type': 'application/json',
      ...options.headers
    };

    if (token) {
      headers['Authorization'] = `Bearer ${token}`;
    }

    const response = await fetch(`/api${endpoint}`, {
      ...options,
      headers
    });

    if (response.status === 401) {
      logout();
      throw new Error('Unauthorized');
    }

    const data = await response.json();
    
    if (!response.ok) {
      throw new Error(data.error || 'Request failed');
    }

    return data;
  };

  // Initialize App
  function init() {
    if (token && user) {
      showApp();
    } else {
      document.getElementById('login-screen').style.display = 'flex';
      document.getElementById('app').style.display = 'none';
    }

    setupEventListeners();
    connectSocket();
  }

  // Setup Event Listeners
  function setupEventListeners() {
    // Login form
    document.getElementById('login-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      const username = document.getElementById('username').value;
      const password = document.getElementById('password').value;

      try {
        const data = await api('/auth/login', {
          method: 'POST',
          body: JSON.stringify({ username, password })
        });

        token = data.token;
        user = data.user;
        localStorage.setItem('ttk_token', token);
        localStorage.setItem('ttk_user', JSON.stringify(user));
        
        showApp();
      } catch (error) {
        alert(error.message);
      }
    });

    // Navigation
    document.querySelectorAll('.nav-link').forEach(link => {
      link.addEventListener('click', (e) => {
        e.preventDefault();
        const page = link.dataset.page;
        navigateTo(page);
      });
    });

    // Profile form
    document.getElementById('profile-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      const fullName = document.getElementById('profile-name').value;
      const department = document.getElementById('profile-department').value;
      const password = document.getElementById('profile-password').value;

      try {
        await api('/auth/profile', {
          method: 'PUT',
          body: JSON.stringify({ fullName, department })
        });

        if (password) {
          await api('/auth/change-password', {
            method: 'POST',
            body: JSON.stringify({ currentPassword: '', newPassword: password })
          });
        }

        alert('Профиль обновлен!');
      } catch (error) {
        alert(error.message);
      }
    });

    // Global search
    document.getElementById('global-search').addEventListener('input', debounce(async (e) => {
      const query = e.target.value.trim();
      if (query.length >= 2) {
        await searchGlobal(query);
      }
    }, 300));
  }

  // Show App
  function showApp() {
    document.getElementById('login-screen').style.display = 'none';
    document.getElementById('app').style.display = 'block';
    
    // Update user info
    document.getElementById('user-name').textContent = user.fullName || user.username;
    document.getElementById('user-role').textContent = getRoleName(user.role);
    document.getElementById('user-avatar').textContent = (user.fullName || user.username)[0].toUpperCase();

    // Show admin link for admins
    if (user.role === 'admin') {
      document.getElementById('admin-link').style.display = 'block';
    }

    // Load dashboard
    loadDashboard();
    navigateTo('dashboard');
  }

  // Get Role Name
  function getRoleName(role) {
    const roles = {
      guest: 'Гость',
      operator: 'Оператор',
      admin: 'Администратор'
    };
    return roles[role] || role;
  }

  // Navigate to Page
  function navigateTo(page) {
    // Update nav links
    document.querySelectorAll('.nav-link').forEach(link => {
      link.classList.toggle('active', link.dataset.page === page);
    });

    // Hide all pages
    document.querySelectorAll('.page').forEach(p => p.classList.add('hidden'));

    // Show selected page
    const targetPage = document.getElementById(`page-${page}`);
    if (targetPage) {
      targetPage.classList.remove('hidden');
    }

    // Load page data
    switch(page) {
      case 'dashboard':
        loadDashboard();
        break;
      case 'cards':
        loadCards();
        break;
      case 'ingredients':
        loadIngredients();
        break;
      case 'production':
        loadProductionRequests();
        break;
      case 'news':
        loadNews();
        break;
      case 'admin':
        if (user.role === 'admin') loadUsers();
        break;
      case 'profile':
        loadProfile();
        break;
    }

    // Close sidebar on mobile
    if (window.innerWidth <= 1024) {
      document.getElementById('sidebar').classList.remove('active');
    }
  }

  // Toggle Sidebar
  function toggleSidebar() {
    document.getElementById('sidebar').classList.toggle('active');
  }

  // Login as Guest
  window.loginAsGuest = async function() {
    try {
      const data = await api('/auth/login', {
        method: 'POST',
        body: JSON.stringify({ username: 'guest', password: '' })
      });

      token = data.token;
      user = data.user;
      localStorage.setItem('ttk_token', token);
      localStorage.setItem('ttk_user', JSON.stringify(user));
      
      showApp();
    } catch (error) {
      alert(error.message);
    }
  };

  // Logout
  window.logout = function() {
    token = null;
    user = null;
    localStorage.removeItem('ttk_token');
    localStorage.removeItem('ttk_user');
    location.reload();
  };

  // Connect Socket.IO
  function connectSocket() {
    socket = io();

    socket.on('connect', () => {
      console.log('Connected to server');
      socket.emit('join_room', 'kitchen');
    });

    socket.on('card_updated', (data) => {
      console.log('Card updated:', data);
      if (document.getElementById('page-cards').classList.contains('hidden') === false) {
        loadCards();
      }
      showNotification(`Карта обновлена: ${data.title || data.cardId}`);
    });

    socket.on('new_production_request', (data) => {
      showNotification(`Новый запрос на производство: ${data.cardTitle}`);
      updateBadge();
    });

    socket.on('ingredient_added', (data) => {
      if (document.getElementById('page-ingredients').classList.contains('hidden') === false) {
        loadIngredients();
      }
    });

    socket.on('system_notification', (data) => {
      showNotification(data.message);
    });
  }

  // Load Dashboard
  async function loadDashboard() {
    try {
      const stats = await api('/dashboard/stats');

      document.getElementById('stat-cards').textContent = stats.totalCards;
      document.getElementById('stat-ingredients').textContent = stats.totalIngredients;
      document.getElementById('stat-pending').textContent = stats.pendingRequests;
      document.getElementById('stat-users').textContent = stats.activeUsers;

      // Chart: Cards by Type
      const typeCtx = document.getElementById('chart-types').getContext('2d');
      if (charts.types) charts.types.destroy();

      charts.types = new Chart(typeCtx, {
        type: 'doughnut',
        data: {
          labels: stats.cardsByType.map(t => getTypeName(t.type)),
          datasets: [{
            data: stats.cardsByType.map(t => t.count),
            backgroundColor: ['#007AFF', '#FF9500', '#34C759', '#5856D6', '#FF3B30', '#AF52DE']
          }]
        },
        options: {
          responsive: true,
          maintainAspectRatio: false
        }
      });

      // Chart: Monthly Production
      const monthlyCtx = document.getElementById('chart-monthly').getContext('2d');
      if (charts.monthly) charts.monthly.destroy();

      charts.monthly = new Chart(monthlyCtx, {
        type: 'bar',
        data: {
          labels: stats.monthlyProduction.map(m => m.month),
          datasets: [{
            label: 'Запросов',
            data: stats.monthlyProduction.map(m => m.count),
            backgroundColor: '#007AFF',
            borderRadius: 8
          }]
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          scales: {
            y: { beginAtZero: true }
          }
        }
      });

      // Top Cards
      const topCardsList = document.getElementById('top-cards-list');
      topCardsList.innerHTML = stats.topCards.slice(0, 5).map(card => `
        <div class="card-item" onclick="viewCard('${card.card_id}')">
          <span class="card-type-badge ${card.type}">${getTypeName(card.type)}</span>
          <div class="card-info">
            <div class="card-title">${card.title}</div>
            <div class="card-meta">${card.production_count} производств</div>
          </div>
        </div>
      `).join('');

    } catch (error) {
      console.error('Failed to load dashboard:', error);
    }
  }

  // Get Type Name
  function getTypeName(type) {
    const names = {
      dish: 'Блюдо',
      sauce: 'Соус',
      salad: 'Салат',
      soup: 'Суп',
      dessert: 'Десерт',
      beverage: 'Напиток',
      semi_finished: 'П/Ф'
    };
    return names[type] || type;
  }

  // Load Cards
  async function loadCards() {
    try {
      const type = document.getElementById('filter-type').value;
      const data = await api(`/cards${type ? `?type=${type}` : ''}`);

      const container = document.getElementById('cards-container');
      container.innerHTML = data.cards.map(card => `
        <div class="card-item" onclick="viewCard('${card.card_id}')">
          <span class="card-type-badge ${card.type}">${getTypeName(card.type)}</span>
          <div class="card-info">
            <div class="card-title">${card.title}</div>
            <div class="card-meta">Выход: ${card.yield}г • ТУ: ${card.tu_number || '—'} • ${formatDate(card.updated_at)}</div>
          </div>
          <div class="card-actions">
            <button class="action-btn" onclick="event.stopPropagation(); exportCard('${card.card_id}', 'pdf')" title="PDF">
              <i class="fas fa-file-pdf"></i>
            </button>
            <button class="action-btn" onclick="event.stopPropagation(); exportCard('${card.card_id}', 'excel')" title="Excel">
              <i class="fas fa-file-excel"></i>
            </button>
            <button class="action-btn" onclick="event.stopPropagation(); exportCard('${card.card_id}', 'json')" title="JSON">
              <i class="fas fa-file-code"></i>
            </button>
          </div>
        </div>
      `).join('');

    } catch (error) {
      console.error('Failed to load cards:', error);
    }
  }

  // View Card
  window.viewCard = function(cardId) {
    // Open card detail modal (to be implemented)
    alert('Просмотр карты: ' + cardId);
  };

  // Export Card
  window.exportCard = function(cardId, format) {
    window.open(`/api/export/${format}/${cardId}`, '_blank');
  };

  // Create New Card
  window.createNewCard = function() {
    document.getElementById('card-modal').classList.add('active');
  };

  // Close Modal
  window.closeModal = function(modalId) {
    document.getElementById(modalId).classList.remove('active');
  };

  // Save Card
  window.saveCard = async function() {
    try {
      const type = document.getElementById('card-type').value;
      const yield_val = parseFloat(document.getElementById('card-yield').value);
      const title = document.getElementById('card-title').value;
      const tu = document.getElementById('card-tu').value;

      if (!title || !yield_val) {
        alert('Заполните название и выход');
        return;
      }

      await api('/cards', {
        method: 'POST',
        body: JSON.stringify({
          title,
          type,
          yield: yield_val,
          tuNumber: tu
        })
      };

      closeModal('card-modal');
      loadCards();
      showNotification('Карта создана!');
    } catch (error) {
      alert(error.message);
    }
  };

  // Load Ingredients
  async function loadIngredients() {
    try {
      const ingredients = await api('/ingredients?limit=100');
      
      const tbody = document.getElementById('ingredients-table-body');
      tbody.innerHTML = ingredients.map(ing => `
        <tr>
          <td><strong>${ing.name}</strong></td>
          <td>${ing.category || '—'}</td>
          <td>${ing.unit}</td>
          <td>${ing.cost_per_kg ? ing.cost_per_kg.toFixed(2) : '—'} ₽</td>
          <td>${ing.allergens || '—'}</td>
          <td>
            <button class="action-btn" onclick="editIngredient(${ing.id})">
              <i class="fas fa-edit"></i>
            </button>
            ${user.role === 'admin' ? `
            <button class="action-btn" onclick="deleteIngredient(${ing.id})">
              <i class="fas fa-trash"></i>
            </button>
            ` : ''}
          </td>
        </tr>
      `).join('');
    } catch (error) {
      console.error('Failed to load ingredients:', error);
    }
  }

  // Search Ingredients
  window.searchIngredients = async function() {
    const query = document.getElementById('ingredient-search').value;
    if (query.length >= 2) {
      const ingredients = await api(`/ingredients?search=${encodeURIComponent(query)}&limit=50`);
      // Render results...
    }
  };

  // Add Ingredient
  window.addIngredient = function() {
    const name = prompt('Название ингредиента:');
    if (name) {
      // Open modal or quick add
      alert('Функция добавления ингредиента: ' + name);
    }
  };

  // Edit Ingredient
  window.editIngredient = function(id) {
    alert('Редактирование ингредиента #' + id);
  };

  // Delete Ingredient
  window.deleteIngredient = async function(id) {
    if (confirm('Удалить ингредиент?')) {
      try {
        await api(`/ingredients/${id}`, { method: 'DELETE' });
        loadIngredients();
        showNotification('Ингредиент удален');
      } catch (error) {
        alert(error.message);
      }
    }
  };

  // Load Production Requests
  async function loadProductionRequests() {
    try {
      const requests = await api('/production-requests?status=pending');
      
      const container = document.getElementById('production-requests');
      container.innerHTML = requests.map(req => `
        <div class="card-item">
          <div class="card-info">
            <div class="card-title">${req.card_title}</div>
            <div class="card-meta">
              Запросил: ${req.requester_name} • Выход: ${req.target_yield}г • 
              Партии: ${req.batches} • ${formatDate(req.created_at)}
            </div>
          </div>
          <div class="card-actions">
            <button class="btn btn-primary btn-sm" onclick="approveRequest(${req.id})">
              <i class="fas fa-check"></i> Принять
            </button>
          </div>
        </div>
      `).join('');
    } catch (error) {
      console.error('Failed to load production requests:', error);
    }
  }

  // Create Production Request
  window.createProductionRequest = function() {
    alert('Создание запроса на производство');
  };

  // Approve Request
  window.approveRequest = async function(id) {
    try {
      await api(`/production-requests/${id}/status`, {
        method: 'PUT',
        body: JSON.stringify({ status: 'approved' })
      };
      loadProductionRequests();
      showNotification('Запрос одобрен');
    } catch (error) {
      alert(error.message);
    }
  };

  // Create Checklist
  window.createChecklist = function(type) {
    alert('Создание чеклиста: ' + type);
  };

  // Load News
  async function loadNews() {
    try {
      const news = await api('/news');
      
      const feed = document.getElementById('news-feed');
      feed.innerHTML = news.map(post => `
        <div class="news-post">
          <div class="news-header">
            <div class="news-avatar">${(post.author_name || 'A')[0]}</div>
            <div>
              <div class="news-author">${post.author_name || 'Аноним'}</div>
              <div class="news-time">${formatDate(post.created_at)}</div>
            </div>
          </div>
          <div class="news-content">${post.content}</div>
          ${post.media_paths ? `
          <div class="news-media">
            <img src="${JSON.parse(post.media_paths)[0]}" alt="Media">
          </div>
          ` : ''}
          <div class="news-actions">
            <div class="news-action"><i class="far fa-heart"></i> ${post.likes}</div>
            <div class="news-action"><i class="far fa-comment"></i> ${post.comments_count}</div>
            <div class="news-action"><i class="far fa-share-square"></i> Поделиться</div>
          </div>
        </div>
      `).join('');
    } catch (error) {
      console.error('Failed to load news:', error);
    }
  }

  // Load Users (Admin)
  async function loadUsers() {
    try {
      const users = await api('/users');
      
      const list = document.getElementById('users-list');
      list.innerHTML = users.map(u => `
        <div class="card-item">
          <div class="user-info">
            <div class="user-avatar">${u.full_name[0] || u.username[0]}</div>
            <div class="user-details">
              <div class="user-name">${u.full_name || u.username}</div>
              <div class="user-role">${getRoleName(u.role)} • ${u.department || '—'}</div>
            </div>
          </div>
          <div class="card-actions">
            <select class="form-input" onchange="changeUserRole(${u.id}, this.value)">
              <option value="guest" ${u.role === 'guest' ? 'selected' : ''}>Гость</option>
              <option value="operator" ${u.role === 'operator' ? 'selected' : ''}>Оператор</option>
              <option value="admin" ${u.role === 'admin' ? 'selected' : ''}>Админ</option>
            </select>
            <button class="action-btn" onclick="resetUserPassword(${u.id})">
              <i class="fas fa-key"></i>
            </button>
          </div>
        </div>
      `).join('');
    } catch (error) {
      console.error('Failed to load users:', error);
    }
  }

  // Change User Role
  window.changeUserRole = async function(userId, role) {
    try {
      await api(`/users/${userId}/role`, {
        method: 'PUT',
        body: JSON.stringify({ role })
      };
      showNotification('Роль изменена');
    } catch (error) {
      alert(error.message);
    }
  };

  // Reset User Password
  window.resetUserPassword = function(userId) {
    const newPassword = prompt('Введите новый пароль:');
    if (newPassword) {
      api('/auth/reset-password', {
        method: 'POST',
        body: JSON.stringify({ userId, newPassword })
      }).then(() => {
        showNotification('Пароль сброшен');
      }).catch(err => alert(err.message));
    }
  };

  // Load Profile
  function loadProfile() {
    document.getElementById('profile-name').value = user.fullName || '';
    document.getElementById('profile-department').value = user.department || '';
  }

  // Search Global
  async function searchGlobal(query) {
    // Implement global search across cards and ingredients
    console.log('Searching:', query);
  }

  // Show Notifications
  window.showNotifications = function() {
    alert('Уведомления');
  };

  // Update Badge
  function updateBadge() {
    const badge = document.getElementById('notif-badge');
    badge.textContent = parseInt(badge.textContent) + 1;
  }

  // Show Notification
  function showNotification(message) {
    // Simple notification
    const div = document.createElement('div');
    div.style.cssText = `
      position: fixed;
      bottom: 20px;
      right: 20px;
      background: #1F2937;
      color: white;
      padding: 1rem 1.5rem;
      border-radius: 8px;
      box-shadow: 0 4px 6px rgba(0,0,0,0.1);
      z-index: 2000;
      animation: slideIn 0.3s ease;
    `;
    div.textContent = message;
    document.body.appendChild(div);
    setTimeout(() => div.remove(), 3000);
  }

  // Format Date
  function formatDate(dateStr) {
    const date = new Date(dateStr);
    return date.toLocaleDateString('ru-RU', {
      day: 'numeric',
      month: 'short',
      hour: '2-digit',
      minute: '2-digit'
    });
  }

  // Debounce
  function debounce(func, wait) {
    let timeout;
    return function executedFunction(...args) {
      const later = () => {
        clearTimeout(timeout);
        func(...args);
      };
      clearTimeout(timeout);
      timeout = setTimeout(later, wait);
    };
  }

  // Export All Cards
  window.exportAllCards = function() {
    alert('Экспорт всех карт (будет реализовано)');
  };

  // Add User
  window.addUser = function() {
    alert('Добавление пользователя');
  };

  // Initialize on DOM ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
