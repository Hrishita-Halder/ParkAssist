import React, { useState, useEffect } from 'react';
import {
  ScrollView,
  View,
  Text,
  TextInput,
  Pressable,
  StyleSheet,
  Alert,
  Modal,
  Platform,
  StatusBar as NativeStatusBar,
  Share,
  ActivityIndicator,
  Image,
  Linking
} from 'react-native';
import { StatusBar } from 'expo-status-bar';
import QRCode from 'react-native-qrcode-svg';

// Default backend API URL. Uses EXPO_PUBLIC_API_URL or defaults to your current LAN IP
const DEFAULT_API_URL = process.env.EXPO_PUBLIC_API_URL || 'http://10.2.5.125:5000/api';

const colors = {
  navy: '#0f172a',
  navyLight: '#1e293b',
  blue: '#2563eb',
  blueLight: '#3b82f6',
  blueBg: '#eff6ff',
  bg: '#f8fafc',
  card: '#ffffff',
  muted: '#64748b',
  border: '#e2e8f0',
  green: '#16a34a',
  greenBg: '#f0fdf4',
  amber: '#d97706',
  amberBg: '#fffbeb',
  red: '#dc2626',
  redBg: '#fef2f2',
  white: '#ffffff',
};

export default function App() {
  const [apiUrl, setApiUrl] = useState(DEFAULT_API_URL);
  const [showConfig, setShowConfig] = useState(false);
  const [loading, setLoading] = useState(false);

  // Navigation: 'signup' | 'login' | 'dashboard' | 'add_vehicle' | 'show_vehicles' | 'database' | 'reports'
  const [currentPage, setCurrentPage] = useState('login');
  const [selectedQrModalVehicle, setSelectedQrModalVehicle] = useState(null);

  // Authentication State
  const [isLoggedIn, setIsLoggedIn] = useState(false);
  const [token, setToken] = useState('');
  const [currentUser, setCurrentUser] = useState(null);

  // Auth Form Fields
  const [authName, setAuthName] = useState('');
  const [authEmail, setAuthEmail] = useState('');
  const [authPhone, setAuthPhone] = useState('');
  const [authPassword, setAuthPassword] = useState('');

  // Dashboard Data
  const [dashboardStats, setDashboardStats] = useState({
    total_vehicles: 0,
    active_reports: 0,
    resolved_reports: 0,
  });
  const [recentReports, setRecentReports] = useState([]);

  // Vehicles and Reports Data
  const [vehicles, setVehicles] = useState([]);
  const [reports, setReports] = useState([]);

  // Add Vehicle Form Fields
  const [newReg, setNewReg] = useState('');
  const [newMake, setNewMake] = useState('');
  const [newModel, setNewModel] = useState('');
  const [newYear, setNewYear] = useState('2024');
  const [newColor, setNewColor] = useState('');
  const [newType, setNewType] = useState('Car');

  // Database Search Page States
  const [dbSearchQuery, setDbSearchQuery] = useState('');
  const [dbTypeFilter, setDbTypeFilter] = useState('All');
  const [dbVehicles, setDbVehicles] = useState([]);

  // Admin Data State
  const [adminTab, setAdminTab] = useState('vehicles');
  const [adminStats, setAdminStats] = useState(null);
  const [adminVehicles, setAdminVehicles] = useState([]);
  const [adminIncidents, setAdminIncidents] = useState([]);
  const [adminUsers, setAdminUsers] = useState([]);

  // Reports Filter state
  const [reportsFilter, setReportsFilter] = useState('All');

  // Generic API Helper
  async function apiCall(endpoint, method = 'GET', body = null, requireAuth = true) {
    const cleanBase = apiUrl.replace(/\/+$/, '');
    const headers = { 'Content-Type': 'application/json' };
    if (requireAuth && token) {
      headers['Authorization'] = `Bearer ${token}`;
    }

    const config = { method, headers };
    if (body) config.body = JSON.stringify(body);

    const res = await fetch(`${cleanBase}${endpoint}`, config);
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      throw new Error(data.error || `HTTP ${res.status}: ${res.statusText}`);
    }
    return data;
  }

  // Load Dashboard Data
  async function fetchDashboard() {
    try {
      setLoading(true);
      const res = await apiCall('/owner/dashboard');
      if (res.stats) setDashboardStats(res.stats);
      if (res.recent_reports) setRecentReports(res.recent_reports);
      if (res.user) setCurrentUser(res.user);
    } catch (err) {
      console.warn('Dashboard fetch error:', err.message);
    } finally {
      setLoading(false);
    }
  }

  // Load Vehicles List
  async function fetchVehicles() {
    try {
      setLoading(true);
      const res = await apiCall('/vehicles');
      setVehicles(res.vehicles || []);
    } catch (err) {
      Alert.alert('Fetch Vehicles Failed', err.message);
    } finally {
      setLoading(false);
    }
  }

  // Load Reports
  async function fetchReports(status = reportsFilter) {
    try {
      setLoading(true);
      const q = status && status !== 'All' ? `?status=${encodeURIComponent(status)}` : '';
      const res = await apiCall(`/incidents/mine${q}`);
      setReports(res.incidents || []);
    } catch (err) {
      Alert.alert('Fetch Reports Failed', err.message);
    } finally {
      setLoading(false);
    }
  }

  // Query Vehicle Database Page
  async function fetchVehicleDatabase(search = dbSearchQuery, type = dbTypeFilter) {
    try {
      setLoading(true);
      const params = new URLSearchParams();
      if (search.trim()) params.append('q', search.trim());
      if (type && type !== 'All') params.append('type', type);
      const res = await apiCall(`/vehicles/database?${params.toString()}`);
      setDbVehicles(res.vehicles || []);
    } catch (err) {
      Alert.alert('Database Search Failed', err.message);
    } finally {
      setLoading(false);
    }
  }

  // Admin Data Fetchers & Deletion
  async function fetchAdminData() {
    try {
      setLoading(true);
      const [s, v, i, u] = await Promise.all([
        apiCall('/admin/stats').catch(() => null),
        apiCall('/admin/vehicles').catch(() => ({ vehicles: [] })),
        apiCall('/admin/incidents').catch(() => ({ incidents: [] })),
        apiCall('/admin/users').catch(() => ({ users: [] })),
      ]);
      if (s) setAdminStats(s);
      setAdminVehicles(v.vehicles || []);
      setAdminIncidents(i.incidents || []);
      setAdminUsers(u.users || []);
    } catch (err) {
      Alert.alert('Admin Access Error', err.message);
    } finally {
      setLoading(false);
    }
  }

  async function deleteAdminVehicle(id, plate) {
    Alert.alert('Delete Vehicle', `Permanently delete ${plate} and all its reports?`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete Permanently',
        style: 'destructive',
        onPress: async () => {
          try {
            await apiCall(`/admin/vehicles/${id}`, 'DELETE');
            Alert.alert('Deleted', `Vehicle ${plate} removed from database.`);
            fetchAdminData();
          } catch (e) {
            Alert.alert('Delete Failed', e.message);
          }
        }
      }
    ]);
  }

  async function deleteAdminIncident(id) {
    Alert.alert('Delete Report', 'Permanently delete this incident report?', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: async () => {
          try {
            await apiCall(`/admin/incidents/${id}`, 'DELETE');
            Alert.alert('Deleted', 'Incident removed.');
            fetchAdminData();
          } catch (e) {
            Alert.alert('Delete Failed', e.message);
          }
        }
      }
    ]);
  }

  async function deleteAdminUser(id, email) {
    Alert.alert('Delete User Account', `Permanently delete user ${email}? This will cascade and delete all their vehicles and reports!`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete User & Data',
        style: 'destructive',
        onPress: async () => {
          try {
            await apiCall(`/admin/users/${id}`, 'DELETE');
            Alert.alert('Deleted', `User ${email} and associated data deleted.`);
            fetchAdminData();
          } catch (e) {
            Alert.alert('Delete Failed', e.message);
          }
        }
      }
    ]);
  }

  // Effect to load page data when tab switches
  useEffect(() => {
    if (!isLoggedIn) return;
    if (currentPage === 'dashboard') fetchDashboard();
    else if (currentPage === 'show_vehicles') fetchVehicles();
    else if (currentPage === 'reports') fetchReports();
    else if (currentPage === 'database') fetchVehicleDatabase();
    else if (currentPage === 'admin_console') fetchAdminData();
  }, [currentPage, isLoggedIn]);

  // Real-time Background Polling for Owner In-App Notifications
  useEffect(() => {
    if (!isLoggedIn || !token) return;

    // Check for new incident reports every 5 seconds
    const interval = setInterval(async () => {
      try {
        const cleanBase = apiUrl.replace(/\/+$/, '');
        const res = await fetch(`${cleanBase}/incidents/mine`, {
          headers: { 'Authorization': `Bearer ${token}` }
        });
        const data = await res.json();
        if (data && data.incidents) {
          setReports((prev) => {
            if (prev.length > 0 && data.incidents.length > prev.length) {
              const newest = data.incidents[0];
              Alert.alert(
                '🚨 New Incident Reported!',
                `${newest.type} reported for ${newest.reg_number || 'your vehicle'}:\n\n"${newest.description}"\n\nLocation: ${newest.location || 'Nearby'}`
              );
              fetchDashboard();
            }
            return data.incidents;
          });
        }
      } catch (e) {
        // Silent background check
      }
    }, 5000);

    return () => clearInterval(interval);
  }, [isLoggedIn, token, apiUrl]);

  // Auth Handlers
  const handleLogin = async () => {
    if (!authEmail.trim() || !authPassword.trim()) {
      Alert.alert('Required Fields', 'Please enter your email and password.');
      return;
    }

    try {
      setLoading(true);
      const res = await apiCall('/auth/login', 'POST', {
        email: authEmail.trim(),
        password: authPassword.trim(),
      }, false);

      setToken(res.token);
      setCurrentUser(res.user);
      setIsLoggedIn(true);
      setCurrentPage('dashboard');
    } catch (err) {
      Alert.alert(
        'Login Failed',
        `${err.message}\n\nMake sure the backend is running at:\n${apiUrl}`
      );
    } finally {
      setLoading(false);
    }
  };

  const handleSignup = async () => {
    if (!authName.trim() || !authEmail.trim() || !authPassword.trim()) {
      Alert.alert('Required Fields', 'Please fill in Name, Email, and Password.');
      return;
    }

    try {
      setLoading(true);
      const res = await apiCall('/auth/register', 'POST', {
        name: authName.trim(),
        email: authEmail.trim(),
        phone: authPhone.trim(),
        password: authPassword.trim(),
      }, false);

      setToken(res.token);
      setCurrentUser(res.user);
      setIsLoggedIn(true);
      Alert.alert('Account Created!', 'Welcome to ParkAssist. Your owner account is ready.');
      setCurrentPage('dashboard');
    } catch (err) {
      Alert.alert(
        'Registration Failed',
        `${err.message}\n\nMake sure the backend is running at:\n${apiUrl}`
      );
    } finally {
      setLoading(false);
    }
  };

  const handleLogout = () => {
    Alert.alert('Log Out', 'Are you sure you want to log out?', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Log Out',
        style: 'destructive',
        onPress: () => {
          setIsLoggedIn(false);
          setToken('');
          setCurrentUser(null);
          setVehicles([]);
          setReports([]);
          setCurrentPage('login');
        },
      },
    ]);
  };

  const handleAddVehicle = async () => {
    if (!newReg.trim() || !newMake.trim() || !newModel.trim()) {
      Alert.alert('Missing Details', 'Please enter Registration Number, Make, and Model.');
      return;
    }

    try {
      setLoading(true);
      const res = await apiCall('/vehicles', 'POST', {
        registration_number: newReg.trim().toUpperCase(),
        make: newMake.trim(),
        model: newModel.trim(),
        year: newYear.trim() || '2024',
        color: newColor.trim() || 'Standard',
        type: newType,
      });

      // Reset Form
      setNewReg('');
      setNewMake('');
      setNewModel('');
      setNewColor('');

      Alert.alert(
        'Vehicle Registered!',
        `Vehicle ${res.vehicle.registration_number} added.\n\nUnique Token: ${res.vehicle.token}`,
        [
          { text: 'View All Vehicles', onPress: () => setCurrentPage('show_vehicles') },
        ]
      );
    } catch (err) {
      Alert.alert('Failed to Add Vehicle', err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleUpdateReportStatus = async (reportId, newStatus) => {
    try {
      setLoading(true);
      await apiCall(`/incidents/${reportId}/status`, 'PATCH', { status: newStatus });
      Alert.alert('Status Updated', `Report marked as "${newStatus}".`);
      fetchReports(reportsFilter);
    } catch (err) {
      Alert.alert('Update Failed', err.message);
    } finally {
      setLoading(false);
    }
  };

  // Helper to get public report URL for a vehicle QR code
  const getVehicleReportUrl = (tokenVal) => {
    // apiUrl looks like http://10.3.5.91:5000/api -> base is http://10.3.5.91:5000
    const baseUrl = apiUrl.replace(/\/api\/?$/, '');
    return `${baseUrl}/report/${encodeURIComponent(tokenVal)}`;
  };

  const handleShareQrToken = (vehicle) => {
    const reportUrl = getVehicleReportUrl(vehicle.token);
    Share.share({
      message: `ParkAssist QR Sticker for ${vehicle.make} ${vehicle.model} (${vehicle.registration_number})\n\nScan this QR code or open this link to alert the owner anonymously:\n${reportUrl}\n\nToken ID: ${vehicle.token}`,
      url: reportUrl,
    });
  };

  // Reusable Header
  const Header = ({ title }) => (
    <View style={styles.header}>
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
        <View>
          <Text style={styles.headerBrand}>{title || 'ParkAssist'}</Text>
          <Text style={styles.headerTagline}>Vehicle Owner Portal</Text>
        </View>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
          <Pressable onPress={() => setShowConfig(true)} style={styles.ipBadgeBtn}>
            <Text style={styles.ipBadgeBtnText}>⚙ API</Text>
          </Pressable>
          {isLoggedIn && (
            <Pressable onPress={handleLogout} style={styles.logoutBtn}>
              <Text style={styles.logoutBtnText}>Log Out</Text>
            </Pressable>
          )}
        </View>
      </View>
    </View>
  );

  // Server IP Config Modal Component
  const renderConfigModal = () => (
    <Modal visible={showConfig} animationType="slide" transparent>
      <View style={styles.modalOverlay}>
        <View style={styles.modalContent}>
          <Text style={styles.modalTitle}>Backend API Configuration</Text>
          <Text style={styles.modalSubtitle}>
            Ensure your phone and computer are on the same Wi-Fi. Enter your computer's IP address:
          </Text>
          <TextInput
            style={styles.modalInput}
            value={apiUrl}
            onChangeText={setApiUrl}
            autoCapitalize="none"
            autoCorrect={false}
            placeholder="http://10.2.5.125:5000/api"
          />
          <View style={{ gap: 8, marginTop: 12 }}>
            <Pressable
              style={styles.primaryButton}
              onPress={() => {
                setShowConfig(false);
                if (isLoggedIn) fetchDashboard();
              }}
            >
              <Text style={styles.primaryButtonText}>Save & Reconnect</Text>
            </Pressable>
            <Pressable style={styles.secondaryButton} onPress={() => setShowConfig(false)}>
              <Text style={styles.secondaryButtonText}>Cancel</Text>
            </Pressable>
          </View>
        </View>
      </View>
    </Modal>
  );

  // Bottom Navigation Bar with Safe Padding
  const BottomNav = () => {
    if (!isLoggedIn) return null;
    const items = [
      { key: 'dashboard', label: 'Dashboard', icon: '📊' },
      { key: 'show_vehicles', label: 'My Vehicles', icon: '🚗' },
      { key: 'add_vehicle', label: 'Add', icon: '➕' },
      { key: 'database', label: 'Database', icon: '🗄️' },
      { key: 'reports', label: 'Reports', icon: '🔔' },
    ];

    // Keep Admin console accessible side by side
    if (currentUser?.role === 'admin') {
      items.push({ key: 'admin_console', label: 'Admin', icon: '🛡️' });
    }

    return (
      <View style={styles.bottomNav}>
        {items.map((it) => {
          const isActive = currentPage === it.key;
          return (
            <Pressable
              key={it.key}
              onPress={() => setCurrentPage(it.key)}
              style={[styles.navItem, isActive && styles.navItemActive]}
            >
              <Text style={styles.navIcon}>{it.icon}</Text>
              <Text style={[styles.navText, isActive && styles.navTextActive]}>{it.label}</Text>
            </Pressable>
          );
        })}
      </View>
    );
  };

  // ==========================================
  // PAGE 1: LOGIN PAGE
  // ==========================================
  if (currentPage === 'login') {
    return (
      <View style={styles.safe}>
        <StatusBar style="light" backgroundColor={colors.navy} />
        <Header title="ParkAssist" />
        <ScrollView contentContainerStyle={styles.authContainer} keyboardShouldPersistTaps="handled">
          <View style={styles.authCard}>
            <View style={{ alignItems: 'center', marginBottom: 16 }}>
              <View style={styles.brandIconCircle}>
                <Text style={{ fontSize: 32 }}>🛡️</Text>
              </View>
              <Text style={styles.pageTitle}>Owner Sign In</Text>
              <Text style={styles.pageSubtitle}>Log in to monitor your vehicles and resolve parking alerts</Text>
            </View>

            <View style={styles.field}>
              <Text style={styles.label}>Email Address</Text>
              <TextInput
                style={styles.input}
                placeholder="name@example.com"
                value={authEmail}
                onChangeText={setAuthEmail}
                keyboardType="email-address"
                autoCapitalize="none"
              />
            </View>

            <View style={styles.field}>
              <Text style={styles.label}>Password</Text>
              <TextInput
                style={styles.input}
                placeholder="••••••••"
                value={authPassword}
                onChangeText={setAuthPassword}
                secureTextEntry
              />
            </View>

            <Pressable style={styles.primaryButton} onPress={handleLogin} disabled={loading}>
              {loading ? (
                <ActivityIndicator color="#fff" />
              ) : (
                <Text style={styles.primaryButtonText}>Sign In</Text>
              )}
            </Pressable>

            <View style={styles.authSwitchRow}>
              <Text style={styles.mutedText}>Don't have an owner account? </Text>
              <Pressable onPress={() => setCurrentPage('signup')}>
                <Text style={styles.linkText}>Create Account</Text>
              </Pressable>
            </View>
          </View>
        </ScrollView>
        {renderConfigModal()}
      </View>
    );
  }

  // ==========================================
  // PAGE 2: SIGNUP PAGE
  // ==========================================
  if (currentPage === 'signup') {
    return (
      <View style={styles.safe}>
        <StatusBar style="light" backgroundColor={colors.navy} />
        <Header title="ParkAssist" />
        <ScrollView contentContainerStyle={styles.authContainer} keyboardShouldPersistTaps="handled">
          <View style={styles.authCard}>
            <View style={{ alignItems: 'center', marginBottom: 16 }}>
              <View style={styles.brandIconCircle}>
                <Text style={{ fontSize: 30 }}>📝</Text>
              </View>
              <Text style={styles.pageTitle}>Create Owner Account</Text>
              <Text style={styles.pageSubtitle}>Anonymous windshield QR stickers for your vehicles</Text>
            </View>

            <View style={styles.field}>
              <Text style={styles.label}>Full Name</Text>
              <TextInput
                style={styles.input}
                placeholder="e.g. John Doe"
                value={authName}
                onChangeText={setAuthName}
              />
            </View>

            <View style={styles.field}>
              <Text style={styles.label}>Email Address</Text>
              <TextInput
                style={styles.input}
                placeholder="name@example.com"
                value={authEmail}
                onChangeText={setAuthEmail}
                keyboardType="email-address"
                autoCapitalize="none"
              />
            </View>

            <View style={styles.field}>
              <Text style={styles.label}>Phone Number (For Private SMS / Alerts)</Text>
              <TextInput
                style={styles.input}
                placeholder="+91 98765 43210"
                value={authPhone}
                onChangeText={setAuthPhone}
                keyboardType="phone-pad"
              />
            </View>

            <View style={styles.field}>
              <Text style={styles.label}>Password (Min. 6 characters)</Text>
              <TextInput
                style={styles.input}
                placeholder="••••••••"
                value={authPassword}
                onChangeText={setAuthPassword}
                secureTextEntry
              />
            </View>

            <Pressable style={styles.primaryButton} onPress={handleSignup} disabled={loading}>
              {loading ? (
                <ActivityIndicator color="#fff" />
              ) : (
                <Text style={styles.primaryButtonText}>Register as Owner</Text>
              )}
            </Pressable>

            <View style={styles.authSwitchRow}>
              <Text style={styles.mutedText}>Already have an account? </Text>
              <Pressable onPress={() => setCurrentPage('login')}>
                <Text style={styles.linkText}>Log In</Text>
              </Pressable>
            </View>
          </View>
        </ScrollView>
        {renderConfigModal()}
      </View>
    );
  }

  // ==========================================
  // PAGE 3: DASHBOARD PAGE
  // ==========================================
  const renderDashboard = () => (
    <ScrollView contentContainerStyle={styles.pageScroll} keyboardShouldPersistTaps="handled">
      {/* Welcome Banner */}
      <View style={styles.welcomeBanner}>
        <Text style={styles.welcomeGreeting}>Welcome back,</Text>
        <Text style={styles.welcomeName}>{currentUser?.name || 'Vehicle Owner'}</Text>
        <Text style={styles.welcomeSub}>{currentUser?.email} {currentUser?.phone ? `• ${currentUser.phone}` : ''}</Text>
        <View style={{ flexDirection: 'row', gap: 6, marginTop: 8, flexWrap: 'wrap' }}>
          <View style={{ backgroundColor: 'rgba(255,255,255,0.15)', paddingVertical: 3, paddingHorizontal: 8, borderRadius: 6 }}>
            <Text style={{ color: '#fff', fontSize: 10, fontWeight: '700' }}>🔔 Push Alerts Active</Text>
          </View>
          <View style={{ backgroundColor: 'rgba(255,255,255,0.15)', paddingVertical: 3, paddingHorizontal: 8, borderRadius: 6 }}>
            <Text style={{ color: '#fff', fontSize: 10, fontWeight: '700' }}>📧 Email Alerts Active</Text>
          </View>
          <View style={{ backgroundColor: 'rgba(255,255,255,0.15)', paddingVertical: 3, paddingHorizontal: 8, borderRadius: 6 }}>
            <Text style={{ color: '#fff', fontSize: 10, fontWeight: '700' }}>📱 SMS Alerts Active</Text>
          </View>
        </View>
      </View>

      {/* Quick Stats Grid */}
      <View style={styles.statsGrid}>
        <Pressable style={styles.statBox} onPress={() => setCurrentPage('show_vehicles')}>
          <Text style={styles.statIcon}>🚗</Text>
          <Text style={styles.statNumber}>{dashboardStats.total_vehicles}</Text>
          <Text style={styles.statLabel}>Registered Vehicles</Text>
        </Pressable>

        <Pressable style={styles.statBox} onPress={() => setCurrentPage('reports')}>
          <Text style={styles.statIcon}>⚠️</Text>
          <Text style={[styles.statNumber, { color: colors.amber }]}>
            {dashboardStats.active_reports}
          </Text>
          <Text style={styles.statLabel}>Active Reports</Text>
        </Pressable>

        <Pressable style={styles.statBox} onPress={() => setCurrentPage('reports')}>
          <Text style={styles.statIcon}>✅</Text>
          <Text style={[styles.statNumber, { color: colors.green }]}>
            {dashboardStats.resolved_reports}
          </Text>
          <Text style={styles.statLabel}>Resolved Reports</Text>
        </Pressable>
      </View>

      {/* Quick Action Shortcuts */}
      <View style={styles.quickActionCard}>
        <Text style={styles.cardHeaderTitle}>Quick Actions</Text>
        <View style={styles.quickActionRow}>
          <Pressable style={styles.quickActionButton} onPress={() => setCurrentPage('add_vehicle')}>
            <Text style={{ fontSize: 20 }}>➕</Text>
            <Text style={styles.quickActionText}>Add Vehicle</Text>
          </Pressable>

          <Pressable style={styles.quickActionButton} onPress={() => setCurrentPage('show_vehicles')}>
            <Text style={{ fontSize: 20 }}>🏷️</Text>
            <Text style={styles.quickActionText}>My QR Codes</Text>
          </Pressable>

          <Pressable style={styles.quickActionButton} onPress={() => setCurrentPage('database')}>
            <Text style={{ fontSize: 20 }}>🗄️</Text>
            <Text style={styles.quickActionText}>DB Search</Text>
          </Pressable>

          <Pressable style={styles.quickActionButton} onPress={() => setCurrentPage('reports')}>
            <Text style={{ fontSize: 20 }}>🔔</Text>
            <Text style={styles.quickActionText}>Reports</Text>
          </Pressable>
        </View>
      </View>

      {/* Recent Alerts Feed */}
      <View style={styles.sectionHeaderRow}>
        <Text style={styles.sectionHeading}>Recent Incident Alerts</Text>
        <Pressable onPress={() => setCurrentPage('reports')}>
          <Text style={styles.seeAllText}>View All →</Text>
        </Pressable>
      </View>

      {recentReports.length === 0 ? (
        <View style={styles.emptyCard}>
          <Text style={{ fontSize: 30 }}>✨</Text>
          <Text style={styles.emptyTitle}>No Recent Incidents</Text>
          <Text style={styles.emptySub}>All your parked vehicles are safe and clear.</Text>
        </View>
      ) : (
        recentReports.map((item) => (
          <View key={item.id} style={styles.reportCard}>
            <View style={styles.reportTopRow}>
              <View>
                <Text style={styles.reportPlate}>{item.reg_number || 'Vehicle Alert'}</Text>
                <Text style={styles.reportType}>{item.type}</Text>
              </View>
              <View
                style={[
                  styles.statusBadge,
                  item.status === 'Open' ? styles.statusBadgeOpen : styles.statusBadgeAck,
                ]}
              >
                <Text
                  style={[
                    styles.statusBadgeText,
                    item.status === 'Open' ? styles.statusTextOpen : styles.statusTextAck,
                  ]}
                >
                  {item.status}
                </Text>
              </View>
            </View>
            <Text style={styles.reportDesc}>{item.description}</Text>
            <View style={styles.reportFooter}>
              <Text style={styles.reportMeta}>📍 {item.location || 'Nearby'}</Text>
              <Text style={styles.reportMeta}>
                🕒 {item.created_at ? new Date(item.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : 'Recent'}
              </Text>
            </View>
          </View>
        ))
      )}
    </ScrollView>
  );

  // ==========================================
  // PAGE 4: ADD VEHICLE PAGE
  // ==========================================
  const renderAddVehicle = () => (
    <ScrollView contentContainerStyle={styles.pageScroll} keyboardShouldPersistTaps="handled">
      <View style={styles.card}>
        <Text style={styles.cardHeaderTitle}>Add New Vehicle</Text>
        <Text style={styles.cardHeaderSub}>
          Register your car or bike to generate an anonymous ParkAssist QR code.
        </Text>

        <View style={styles.field}>
          <Text style={styles.label}>Registration Number *</Text>
          <TextInput
            style={styles.input}
            placeholder="e.g. DL 01 AB 1234"
            value={newReg}
            onChangeText={setNewReg}
            autoCapitalize="characters"
          />
        </View>

        <View style={{ flexDirection: 'row', gap: 12 }}>
          <View style={[styles.field, { flex: 1 }]}>
            <Text style={styles.label}>Brand / Make *</Text>
            <TextInput
              style={styles.input}
              placeholder="e.g. Honda"
              value={newMake}
              onChangeText={setNewMake}
            />
          </View>
          <View style={[styles.field, { flex: 1 }]}>
            <Text style={styles.label}>Model *</Text>
            <TextInput
              style={styles.input}
              placeholder="e.g. City"
              value={newModel}
              onChangeText={setNewModel}
            />
          </View>
        </View>

        <View style={{ flexDirection: 'row', gap: 12 }}>
          <View style={[styles.field, { flex: 1 }]}>
            <Text style={styles.label}>Vehicle Color</Text>
            <TextInput
              style={styles.input}
              placeholder="e.g. White"
              value={newColor}
              onChangeText={setNewColor}
            />
          </View>
          <View style={[styles.field, { flex: 1 }]}>
            <Text style={styles.label}>Model Year</Text>
            <TextInput
              style={styles.input}
              placeholder="e.g. 2024"
              value={newYear}
              onChangeText={setNewYear}
              keyboardType="numeric"
            />
          </View>
        </View>

        <View style={styles.field}>
          <Text style={styles.label}>Vehicle Type</Text>
          <View style={styles.chipsRow}>
            {['Car', 'SUV', 'Two-Wheeler', 'EV', 'Van'].map((type) => (
              <Pressable
                key={type}
                onPress={() => setNewType(type)}
                style={[styles.chip, newType === type && styles.chipActive]}
              >
                <Text style={[styles.chipText, newType === type && styles.chipTextActive]}>{type}</Text>
              </Pressable>
            ))}
          </View>
        </View>

        <View style={styles.privacyNoteBox}>
          <Text style={styles.privacyNoteTitle}>🛡️ Privacy Guaranteed</Text>
          <Text style={styles.privacyNoteText}>
            Your phone number and name are never displayed to anyone scanning the QR code on your windshield.
          </Text>
        </View>

        <Pressable style={styles.primaryButton} onPress={handleAddVehicle} disabled={loading}>
          {loading ? (
            <ActivityIndicator color="#fff" />
          ) : (
            <Text style={styles.primaryButtonText}>Generate QR Code & Save Vehicle</Text>
          )}
        </Pressable>
      </View>
    </ScrollView>
  );

  // ==========================================
  // PAGE 5: SHOW VEHICLES PAGE
  // ==========================================
  const renderShowVehicles = () => (
    <ScrollView contentContainerStyle={styles.pageScroll} keyboardShouldPersistTaps="handled">
      <View style={styles.sectionHeaderRow}>
        <View>
          <Text style={styles.sectionHeading}>My Vehicles</Text>
          <Text style={styles.sectionSubtitle}>View registered vehicles and access their QR tokens</Text>
        </View>
        <Pressable style={styles.smallAddBtn} onPress={() => setCurrentPage('add_vehicle')}>
          <Text style={styles.smallAddBtnText}>+ Add</Text>
        </Pressable>
      </View>

      {vehicles.length === 0 ? (
        <View style={styles.emptyCard}>
          <Text style={{ fontSize: 40, marginBottom: 12 }}>🚗</Text>
          <Text style={styles.emptyTitle}>No Vehicles Registered Yet</Text>
          <Text style={styles.emptySub}>Add your first car or bike to generate its QR windshield sticker.</Text>
          <Pressable style={styles.primaryButton} onPress={() => setCurrentPage('add_vehicle')}>
            <Text style={styles.primaryButtonText}>+ Add Your Vehicle</Text>
          </Pressable>
        </View>
      ) : (
        vehicles.map((v) => (
          <View key={v.id} style={styles.vehicleCard}>
            <View style={styles.vehicleHeader}>
              <View style={{ flex: 1 }}>
                <Text style={styles.vehiclePlate}>{v.registration_number}</Text>
                <Text style={styles.vehicleSub}>
                  {v.make} {v.model} ({v.year || '2024'}) • {v.color || 'Standard'}
                </Text>
              </View>
              <View style={styles.typeBadge}>
                <Text style={styles.typeBadgeText}>{v.type || 'Car'}</Text>
              </View>
            </View>

            {/* QR Preview Mini Bar */}
            <View style={styles.qrMiniBox}>
              <View style={{ backgroundColor: '#fff', padding: 6, borderRadius: 6 }}>
                <QRCode value={getVehicleReportUrl(v.token)} size={60} />
              </View>
              <View style={{ flex: 1, gap: 4 }}>
                <Text style={styles.qrLabelText}>QR Token ID:</Text>
                <Text style={styles.qrTokenCode}>{v.token}</Text>
                <Text style={styles.qrTokenHint}>
                  {v.active_incidents > 0
                    ? `⚠️ ${v.active_incidents} active issue reported`
                    : '✅ Scannable by any phone camera'}
                </Text>
              </View>
            </View>

            {/* Action Buttons */}
            <View style={styles.vehicleActionRow}>
              <Pressable
                style={[styles.vehicleActionBtn, styles.vehicleActionBtnPrimary]}
                onPress={() => setSelectedQrModalVehicle(v)}
              >
                <Text style={styles.actionBtnPrimaryText}>🔍 View Large QR</Text>
              </Pressable>

              <Pressable style={styles.vehicleActionBtn} onPress={() => handleShareQrToken(v)}>
                <Text style={styles.actionBtnSecondaryText}>📤 Share / Print</Text>
              </Pressable>
            </View>
          </View>
        ))
      )}
    </ScrollView>
  );

  // ==========================================
  // PAGE 6: VEHICLE DATABASE PAGE (Search & Inspect)
  // ==========================================
  const renderVehicleDatabase = () => (
    <ScrollView contentContainerStyle={styles.pageScroll} keyboardShouldPersistTaps="handled">
      <View>
        <Text style={styles.sectionHeading}>Vehicle Database</Text>
        <Text style={styles.sectionSubtitle}>
          Search and inspect registered vehicles, active tokens, and records.
        </Text>
      </View>

      {/* Search Input */}
      <View style={styles.searchBox}>
        <TextInput
          style={styles.searchInput}
          placeholder="Search plate, make, model, or token..."
          value={dbSearchQuery}
          onChangeText={(txt) => {
            setDbSearchQuery(txt);
            fetchVehicleDatabase(txt, dbTypeFilter);
          }}
        />
        {dbSearchQuery.length > 0 && (
          <Pressable
            onPress={() => {
              setDbSearchQuery('');
              fetchVehicleDatabase('', dbTypeFilter);
            }}
            style={styles.clearSearchBtn}
          >
            <Text style={{ fontSize: 14, color: colors.muted }}>✕</Text>
          </Pressable>
        )}
      </View>

      {/* Type Filter Pills */}
      <View style={styles.filterPillsRow}>
        {['All', 'Car', 'SUV', 'EV', 'Two-Wheeler'].map((t) => (
          <Pressable
            key={t}
            onPress={() => {
              setDbTypeFilter(t);
              fetchVehicleDatabase(dbSearchQuery, t);
            }}
            style={[styles.filterPill, dbTypeFilter === t && styles.filterPillActive]}
          >
            <Text style={[styles.filterPillText, dbTypeFilter === t && styles.filterPillTextActive]}>
              {t}
            </Text>
          </Pressable>
        ))}
      </View>

      {/* Search Results Summary */}
      <Text style={styles.dbCountText}>
        Found {dbVehicles.length} vehicle record{dbVehicles.length === 1 ? '' : 's'}
      </Text>

      {dbVehicles.length === 0 ? (
        <View style={styles.emptyCard}>
          <Text style={{ fontSize: 32 }}>🔍</Text>
          <Text style={styles.emptyTitle}>No Matching Records</Text>
          <Text style={styles.emptySub}>No vehicles found matching your search query.</Text>
        </View>
      ) : (
        dbVehicles.map((item) => (
          <View key={item.id} style={styles.dbCard}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' }}>
              <View>
                <Text style={styles.dbPlate}>{item.registration_number}</Text>
                <Text style={styles.dbMakeModel}>{item.make} {item.model}</Text>
              </View>
              <View style={styles.dbTypeTag}>
                <Text style={styles.dbTypeTagText}>{item.type || 'Car'}</Text>
              </View>
            </View>

            <View style={styles.dbMetaGrid}>
              <View style={styles.dbMetaItem}>
                <Text style={styles.dbMetaLabel}>Year</Text>
                <Text style={styles.dbMetaVal}>{item.year || '2024'}</Text>
              </View>
              <View style={styles.dbMetaItem}>
                <Text style={styles.dbMetaLabel}>Color</Text>
                <Text style={styles.dbMetaVal}>{item.color || 'Standard'}</Text>
              </View>
              <View style={styles.dbMetaItem}>
                <Text style={styles.dbMetaLabel}>Reports</Text>
                <Text style={styles.dbMetaVal}>{item.incident_count || 0}</Text>
              </View>
            </View>

            <View style={styles.dbTokenBar}>
              <Text style={styles.dbTokenLabel}>TOKEN: </Text>
              <Text style={styles.dbTokenText}>{item.token}</Text>
            </View>
          </View>
        ))
      )}
    </ScrollView>
  );

  // ==========================================
  // PAGE 7: REPORTS / INCIDENTS PAGE
  // ==========================================
  const renderReports = () => (
    <ScrollView contentContainerStyle={styles.pageScroll} keyboardShouldPersistTaps="handled">
      <View>
        <Text style={styles.sectionHeading}>Parking Incident Reports</Text>
        <Text style={styles.sectionSubtitle}>
          Real-time incident notifications reported for your vehicles.
        </Text>
      </View>

      {/* Filter Pills */}
      <View style={styles.filterPillsRow}>
        {['All', 'Open', 'Acknowledged', 'Resolved'].map((st) => (
          <Pressable
            key={st}
            onPress={() => {
              setReportsFilter(st);
              fetchReports(st);
            }}
            style={[styles.filterPill, reportsFilter === st && styles.filterPillActive]}
          >
            <Text style={[styles.filterPillText, reportsFilter === st && styles.filterPillTextActive]}>
              {st}
            </Text>
          </Pressable>
        ))}
      </View>

      {reports.length === 0 ? (
        <View style={styles.emptyCard}>
          <Text style={{ fontSize: 40, marginBottom: 12 }}>🎉</Text>
          <Text style={styles.emptyTitle}>No {reportsFilter !== 'All' ? reportsFilter : ''} Reports</Text>
          <Text style={styles.emptySub}>No active parking incidents recorded for this filter.</Text>
        </View>
      ) : (
        reports.map((rep) => (
          <View key={rep.id} style={styles.reportCard}>
            <View style={styles.reportTopRow}>
              <View>
                <Text style={styles.reportPlate}>{rep.reg_number || 'Registered Vehicle'}</Text>
                <Text style={styles.reportType}>{rep.type}</Text>
              </View>
              <View
                style={[
                  styles.statusBadge,
                  rep.status === 'Open'
                    ? styles.statusBadgeOpen
                    : rep.status === 'Acknowledged'
                    ? styles.statusBadgeAck
                    : styles.statusBadgeResolved,
                ]}
              >
                <Text
                  style={[
                    styles.statusBadgeText,
                    rep.status === 'Open'
                      ? styles.statusTextOpen
                      : rep.status === 'Acknowledged'
                      ? styles.statusTextAck
                      : styles.statusTextResolved,
                  ]}
                >
                  {rep.status}
                </Text>
              </View>
            </View>

            <Text style={styles.reportDesc}>{rep.description}</Text>

            {/* Incident Attached Photo */}
            {rep.image && (
              <View style={styles.reportImageBox}>
                <Image
                  source={{ uri: rep.image }}
                  style={styles.reportImage}
                  resizeMode="cover"
                />
              </View>
            )}

            {/* GPS Coordinates Badge & Google Maps Link */}
            {rep.coordinates && rep.coordinates.latitude && (
              <Pressable
                onPress={() => {
                  const url = `https://www.google.com/maps/search/?api=1&query=${rep.coordinates.latitude},${rep.coordinates.longitude}`;
                  Linking.openURL(url).catch(() => Alert.alert('Could not open map'));
                }}
                style={styles.gpsLinkBox}
              >
                <Text style={styles.gpsLinkIcon}>📍</Text>
                <View style={{ flex: 1 }}>
                  <Text style={styles.gpsLinkTitle}>GPS Location Attached</Text>
                  <Text style={styles.gpsLinkSub}>
                    {rep.coordinates.latitude}, {rep.coordinates.longitude} • Tap to view in Maps
                  </Text>
                </View>
                <Text style={styles.gpsLinkArrow}>↗</Text>
              </Pressable>
            )}

            <View style={styles.reportFooter}>
              <Text style={styles.reportMeta}>📍 {rep.location || 'Nearby'}</Text>
              <Text style={styles.reportMeta}>
                🕒 {rep.created_at ? new Date(rep.created_at).toLocaleString([], { dateStyle: 'short', timeStyle: 'short' }) : 'Recent'}
              </Text>
            </View>

            {/* Status Actions */}
            <View style={styles.reportActions}>
              <Text style={styles.actionPromptText}>Update Incident Status:</Text>
              <View style={{ flexDirection: 'row', gap: 8, flexWrap: 'wrap' }}>
                {rep.status !== 'Acknowledged' && (
                  <Pressable
                    style={styles.reportActionBtn}
                    onPress={() => handleUpdateReportStatus(rep.id, 'Acknowledged')}
                  >
                    <Text style={styles.reportActionBtnText}>👁️ Acknowledge</Text>
                  </Pressable>
                )}
                {rep.status !== 'Resolved' && (
                  <Pressable
                    style={[styles.reportActionBtn, { backgroundColor: colors.greenBg, borderColor: colors.green }]}
                    onPress={() => handleUpdateReportStatus(rep.id, 'Resolved')}
                  >
                    <Text style={[styles.reportActionBtnText, { color: colors.green }]}>
                      ✅ Moved Vehicle / Resolved
                    </Text>
                  </Pressable>
                )}
              </View>
            </View>
          </View>
        ))
      )}
    </ScrollView>
  );

  // ==========================================
  // PAGE 8: ADMIN CONSOLE (DATA MODERATION & PURGE)
  // ==========================================
  const renderAdminConsole = () => (
    <ScrollView contentContainerStyle={styles.pageScroll} keyboardShouldPersistTaps="handled">
      <View>
        <Text style={styles.sectionHeading}>Admin Data Moderation</Text>
        <Text style={styles.sectionSubtitle}>
          Purge or delete test, obsolete, or violating records across the system.
        </Text>
      </View>

      {/* Admin Stats Header */}
      {adminStats && (
        <View style={styles.statsGrid}>
          <View style={styles.statBox}>
            <Text style={styles.statIcon}>👥</Text>
            <Text style={styles.statNumber}>{adminStats.total_users || 0}</Text>
            <Text style={styles.statLabel}>Users</Text>
          </View>
          <View style={styles.statBox}>
            <Text style={styles.statIcon}>🚗</Text>
            <Text style={[styles.statNumber, { color: colors.blue }]}>{adminStats.total_vehicles || 0}</Text>
            <Text style={styles.statLabel}>Vehicles</Text>
          </View>
          <View style={styles.statBox}>
            <Text style={styles.statIcon}>⚠️</Text>
            <Text style={[styles.statNumber, { color: colors.amber }]}>{adminStats.open_incidents || 0}</Text>
            <Text style={styles.statLabel}>Active</Text>
          </View>
        </View>
      )}

      {/* Sub-Tabs: Vehicles / Incidents / Users */}
      <View style={styles.filterPillsRow}>
        {[
          { key: 'vehicles', label: `Vehicles (${adminVehicles.length})` },
          { key: 'incidents', label: `Reports (${adminIncidents.length})` },
          { key: 'users', label: `Users (${adminUsers.length})` },
        ].map((t) => (
          <Pressable
            key={t.key}
            onPress={() => setAdminTab(t.key)}
            style={[styles.filterPill, adminTab === t.key && styles.filterPillActive]}
          >
            <Text style={[styles.filterPillText, adminTab === t.key && styles.filterPillTextActive]}>
              {t.label}
            </Text>
          </Pressable>
        ))}
      </View>

      {/* 1. Admin Vehicles List */}
      {adminTab === 'vehicles' && (
        <View style={{ gap: 10 }}>
          {adminVehicles.length === 0 ? (
            <View style={styles.emptyCard}>
              <Text style={styles.emptyTitle}>No vehicles in database</Text>
            </View>
          ) : (
            adminVehicles.map((v) => (
              <View key={v.id} style={styles.dbCard}>
                <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.dbPlate}>{v.registration_number}</Text>
                    <Text style={styles.dbMakeModel}>{v.make} {v.model} • {v.owner_email}</Text>
                    <Text style={[styles.qrTokenHint, { marginTop: 2 }]}>Token: {v.token}</Text>
                  </View>
                  <Pressable
                    onPress={() => deleteAdminVehicle(v.id, v.registration_number)}
                    style={{ backgroundColor: colors.redBg, borderWidth: 1, borderColor: '#fca5a5', paddingVertical: 6, paddingHorizontal: 10, borderRadius: 8 }}
                  >
                    <Text style={{ color: colors.red, fontSize: 11, fontWeight: '800' }}>🗑️ Delete</Text>
                  </Pressable>
                </View>
              </View>
            ))
          )}
        </View>
      )}

      {/* 2. Admin Incidents List */}
      {adminTab === 'incidents' && (
        <View style={{ gap: 10 }}>
          {adminIncidents.length === 0 ? (
            <View style={styles.emptyCard}>
              <Text style={styles.emptyTitle}>No incident reports</Text>
            </View>
          ) : (
            adminIncidents.map((inc) => (
              <View key={inc.id} style={styles.reportCard}>
                <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.reportPlate}>{inc.reg_number}</Text>
                    <Text style={styles.reportType}>{inc.type} • {inc.status}</Text>
                    <Text style={[styles.reportDesc, { marginTop: 4 }]}>"{inc.description}"</Text>
                  </View>
                  <Pressable
                    onPress={() => deleteAdminIncident(inc.id)}
                    style={{ backgroundColor: colors.redBg, borderWidth: 1, borderColor: '#fca5a5', paddingVertical: 6, paddingHorizontal: 10, borderRadius: 8 }}
                  >
                    <Text style={{ color: colors.red, fontSize: 11, fontWeight: '800' }}>🗑️ Delete</Text>
                  </Pressable>
                </View>
              </View>
            ))
          )}
        </View>
      )}

      {/* 3. Admin Users List */}
      {adminTab === 'users' && (
        <View style={{ gap: 10 }}>
          {adminUsers.map((u) => (
            <View key={u.id} style={styles.dbCard}>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.dbPlate}>{u.name}</Text>
                  <Text style={styles.dbMakeModel}>{u.email} • Role: {u.role}</Text>
                </View>
                {u.role !== 'admin' ? (
                  <Pressable
                    onPress={() => deleteAdminUser(u.id, u.email)}
                    style={{ backgroundColor: colors.redBg, borderWidth: 1, borderColor: '#fca5a5', paddingVertical: 6, paddingHorizontal: 10, borderRadius: 8 }}
                  >
                    <Text style={{ color: colors.red, fontSize: 11, fontWeight: '800' }}>🗑️ Delete User</Text>
                  </Pressable>
                ) : (
                  <Text style={{ fontSize: 11, color: colors.muted, fontStyle: 'italic' }}>Protected</Text>
                )}
              </View>
            </View>
          ))}
        </View>
      )}
    </ScrollView>
  );

  return (
    <View style={styles.safe}>
      <StatusBar style="light" backgroundColor={colors.navy} />
      <Header
        title={
          currentPage === 'dashboard'
            ? 'Owner Dashboard'
            : currentPage === 'show_vehicles'
            ? 'My Vehicles'
            : currentPage === 'add_vehicle'
            ? 'Add Vehicle'
            : currentPage === 'database'
            ? 'Vehicle Database'
            : currentPage === 'reports'
            ? 'Incident Reports'
            : currentPage === 'admin_console'
            ? 'Admin Data Purge'
            : 'ParkAssist'
        }
      />

      <View style={{ flex: 1, backgroundColor: colors.bg }}>
        {currentPage === 'dashboard' && renderDashboard()}
        {currentPage === 'add_vehicle' && renderAddVehicle()}
        {currentPage === 'show_vehicles' && renderShowVehicles()}
        {currentPage === 'database' && renderVehicleDatabase()}
        {currentPage === 'reports' && renderReports()}
        {currentPage === 'admin_console' && renderAdminConsole()}
      </View>

      {/* Bottom Navigation for Owner */}
      <BottomNav />

      {/* QR Code Full Screen Modal */}
      {selectedQrModalVehicle && (
        <Modal visible={true} transparent animationType="fade">
          <View style={styles.modalOverlay}>
            <View style={styles.qrModalCard}>
              <Text style={styles.qrModalTitle}>Windshield QR Sticker</Text>
              <Text style={styles.qrModalPlate}>{selectedQrModalVehicle.registration_number}</Text>
              <Text style={styles.qrModalSub}>
                {selectedQrModalVehicle.make} {selectedQrModalVehicle.model}
              </Text>

              <View style={styles.qrBoxLarge}>
                <QRCode value={getVehicleReportUrl(selectedQrModalVehicle.token)} size={200} />
              </View>

              <Text style={styles.qrTokenDisplay}>Token: {selectedQrModalVehicle.token}</Text>
              <Text style={styles.qrInstruction}>
                Scan with ANY standard phone camera. It immediately opens the web reporting page for this car!
              </Text>
              <Text style={[styles.qrInstruction, { color: colors.blue, fontWeight: '700', marginTop: 2 }]}>
                {getVehicleReportUrl(selectedQrModalVehicle.token)}
              </Text>

              <View style={{ width: '100%', gap: 8, marginTop: 14 }}>
                <Pressable
                  style={styles.primaryButton}
                  onPress={() => handleShareQrToken(selectedQrModalVehicle)}
                >
                  <Text style={styles.primaryButtonText}>Share / Save QR</Text>
                </Pressable>
                <Pressable
                  style={styles.secondaryButton}
                  onPress={() => setSelectedQrModalVehicle(null)}
                >
                  <Text style={styles.secondaryButtonText}>Close</Text>
                </Pressable>
              </View>
            </View>
          </View>
        </Modal>
      )}

      {/* Server IP Config Modal */}
      {renderConfigModal()}
    </View>
  );
}

const styles = StyleSheet.create({
  safe: {
    flex: 1,
    backgroundColor: colors.navy,
    paddingTop: Platform.OS === 'android' ? NativeStatusBar.currentHeight || 0 : 0,
  },
  header: {
    backgroundColor: colors.navy,
    paddingHorizontal: 20,
    paddingTop: 16,
    paddingBottom: 16,
    borderBottomWidth: 1,
    borderBottomColor: colors.navyLight,
  },
  headerBrand: { fontSize: 22, fontWeight: '800', color: colors.white },
  headerTagline: { fontSize: 12, color: '#94a3b8', marginTop: 2 },
  ipBadgeBtn: {
    backgroundColor: '#1e293b',
    borderWidth: 1,
    borderColor: '#334155',
    paddingVertical: 6,
    paddingHorizontal: 10,
    borderRadius: 8,
  },
  ipBadgeBtnText: { color: '#93c5fd', fontSize: 12, fontWeight: '700' },
  logoutBtn: {
    backgroundColor: '#334155',
    paddingVertical: 6,
    paddingHorizontal: 12,
    borderRadius: 8,
  },
  logoutBtnText: { color: '#f8fafc', fontSize: 12, fontWeight: '700' },

  // Bottom Navigation Bar with Safe System Inset
  bottomNav: {
    flexDirection: 'row',
    backgroundColor: colors.white,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    paddingTop: 8,
    paddingBottom: Platform.OS === 'ios' ? 38 : 56,
    paddingHorizontal: 6,
    elevation: 12,
    shadowColor: '#000',
    shadowOpacity: 0.08,
    shadowRadius: 6,
  },
  navItem: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: 4,
    borderRadius: 8,
  },
  navItemActive: {
    backgroundColor: colors.blueBg,
  },
  navIcon: { fontSize: 18, marginBottom: 2 },
  navText: { fontSize: 10, fontWeight: '600', color: colors.muted },
  navTextActive: { color: colors.blue, fontWeight: '800' },

  // Page Scroll Container
  pageScroll: {
    padding: 16,
    paddingBottom: 90,
    gap: 16,
  },

  // Auth Styles
  authContainer: {
    flexGrow: 1,
    justifyContent: 'center',
    padding: 20,
    backgroundColor: colors.bg,
  },
  authCard: {
    backgroundColor: colors.white,
    borderRadius: 20,
    padding: 24,
    borderWidth: 1,
    borderColor: colors.border,
    shadowColor: '#000',
    shadowOpacity: 0.05,
    shadowRadius: 10,
    elevation: 4,
    gap: 12,
  },
  brandIconCircle: {
    width: 60,
    height: 60,
    borderRadius: 30,
    backgroundColor: colors.blueBg,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 8,
  },
  pageTitle: { fontSize: 22, fontWeight: '800', color: colors.navy },
  pageSubtitle: { fontSize: 13, color: colors.muted, textAlign: 'center', marginTop: 4, paddingHorizontal: 10 },
  authSwitchRow: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    marginTop: 12,
  },
  mutedText: { fontSize: 13, color: colors.muted },
  linkText: { fontSize: 13, fontWeight: '700', color: colors.blue },

  // Dashboard Styles
  welcomeBanner: {
    backgroundColor: colors.navy,
    borderRadius: 16,
    padding: 20,
    shadowColor: '#000',
    shadowOpacity: 0.1,
    shadowRadius: 6,
  },
  welcomeGreeting: { fontSize: 14, color: '#93c5fd', fontWeight: '600' },
  welcomeName: { fontSize: 24, fontWeight: '800', color: colors.white, marginTop: 2 },
  welcomeSub: { fontSize: 12, color: '#cbd5e1', marginTop: 4 },

  statsGrid: {
    flexDirection: 'row',
    gap: 10,
  },
  statBox: {
    flex: 1,
    backgroundColor: colors.white,
    borderRadius: 14,
    padding: 14,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: 'center',
    shadowColor: '#000',
    shadowOpacity: 0.02,
    shadowRadius: 4,
  },
  statIcon: { fontSize: 22, marginBottom: 4 },
  statNumber: { fontSize: 22, fontWeight: '800', color: colors.navy },
  statLabel: { fontSize: 11, color: colors.muted, textAlign: 'center', marginTop: 2, fontWeight: '600' },

  quickActionCard: {
    backgroundColor: colors.white,
    borderRadius: 16,
    padding: 16,
    borderWidth: 1,
    borderColor: colors.border,
    gap: 12,
  },
  quickActionRow: {
    flexDirection: 'row',
    gap: 8,
  },
  quickActionButton: {
    flex: 1,
    backgroundColor: colors.bg,
    borderRadius: 12,
    paddingVertical: 12,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: colors.border,
    gap: 4,
  },
  quickActionText: { fontSize: 11, fontWeight: '700', color: colors.navy, textAlign: 'center' },

  sectionHeaderRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  sectionHeading: { fontSize: 18, fontWeight: '800', color: colors.navy },
  sectionSubtitle: { fontSize: 13, color: colors.muted, marginTop: 2 },
  seeAllText: { fontSize: 13, fontWeight: '700', color: colors.blue },

  // Forms & Inputs
  card: {
    backgroundColor: colors.white,
    borderRadius: 16,
    padding: 18,
    borderWidth: 1,
    borderColor: colors.border,
    gap: 12,
  },
  cardHeaderTitle: { fontSize: 18, fontWeight: '800', color: colors.navy },
  cardHeaderSub: { fontSize: 13, color: colors.muted, lineHeight: 18 },
  field: { gap: 6 },
  label: { fontSize: 13, fontWeight: '700', color: colors.navy },
  input: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 14,
    color: colors.navy,
    backgroundColor: '#ffffff',
  },
  chipsRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: {
    borderWidth: 1,
    borderColor: colors.border,
    paddingVertical: 8,
    paddingHorizontal: 14,
    borderRadius: 20,
    backgroundColor: colors.bg,
  },
  chipActive: {
    backgroundColor: colors.navy,
    borderColor: colors.navy,
  },
  chipText: { fontSize: 13, color: colors.navy, fontWeight: '600' },
  chipTextActive: { color: colors.white },

  privacyNoteBox: {
    backgroundColor: colors.blueBg,
    borderRadius: 12,
    padding: 12,
    borderWidth: 1,
    borderColor: '#bfdbfe',
    gap: 4,
  },
  privacyNoteTitle: { fontSize: 13, fontWeight: '700', color: colors.blue },
  privacyNoteText: { fontSize: 12, color: '#1e40af', lineHeight: 17 },

  primaryButton: {
    backgroundColor: colors.blue,
    paddingVertical: 14,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 4,
  },
  primaryButtonText: { color: colors.white, fontSize: 15, fontWeight: '800' },
  secondaryButton: {
    backgroundColor: '#f1f5f9',
    paddingVertical: 12,
    borderRadius: 12,
    alignItems: 'center',
  },
  secondaryButtonText: { color: colors.navy, fontSize: 14, fontWeight: '700' },

  // Vehicle Cards
  smallAddBtn: {
    backgroundColor: colors.blue,
    paddingVertical: 7,
    paddingHorizontal: 14,
    borderRadius: 8,
  },
  smallAddBtnText: { color: colors.white, fontSize: 13, fontWeight: '700' },

  vehicleCard: {
    backgroundColor: colors.white,
    borderRadius: 16,
    padding: 16,
    borderWidth: 1,
    borderColor: colors.border,
    gap: 12,
  },
  vehicleHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
  },
  vehiclePlate: { fontSize: 18, fontWeight: '800', color: colors.navy, letterSpacing: 0.5 },
  vehicleSub: { fontSize: 13, color: colors.muted, marginTop: 3 },
  typeBadge: {
    backgroundColor: colors.bg,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 20,
  },
  typeBadgeText: { fontSize: 11, fontWeight: '700', color: colors.muted },

  qrMiniBox: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#f8fafc',
    borderRadius: 12,
    padding: 10,
    gap: 12,
    borderWidth: 1,
    borderColor: colors.border,
  },
  qrLabelText: { fontSize: 11, fontWeight: '700', color: colors.muted },
  qrTokenCode: { fontSize: 13, fontWeight: '800', color: colors.blue, letterSpacing: 0.5 },
  qrTokenHint: { fontSize: 11, color: colors.muted, lineHeight: 15 },

  vehicleActionRow: {
    flexDirection: 'row',
    gap: 10,
    marginTop: 4,
  },
  vehicleActionBtn: {
    flex: 1,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 10,
    paddingVertical: 10,
    alignItems: 'center',
    backgroundColor: '#f8fafc',
  },
  vehicleActionBtnPrimary: {
    backgroundColor: colors.blueBg,
    borderColor: '#bfdbfe',
  },
  actionBtnPrimaryText: { fontSize: 13, fontWeight: '700', color: colors.blue },
  actionBtnSecondaryText: { fontSize: 13, fontWeight: '700', color: colors.navy },

  // Database Page Styles
  searchBox: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.white,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: 14,
  },
  searchInput: {
    flex: 1,
    paddingVertical: 12,
    fontSize: 14,
    color: colors.navy,
  },
  clearSearchBtn: { padding: 4 },
  dbCountText: { fontSize: 12, color: colors.muted, fontWeight: '600' },
  dbCard: {
    backgroundColor: colors.white,
    borderRadius: 14,
    padding: 14,
    borderWidth: 1,
    borderColor: colors.border,
    gap: 8,
  },
  dbPlate: { fontSize: 16, fontWeight: '800', color: colors.navy },
  dbMakeModel: { fontSize: 13, color: colors.muted, marginTop: 2 },
  dbTypeTag: {
    backgroundColor: colors.blueBg,
    paddingVertical: 3,
    paddingHorizontal: 8,
    borderRadius: 6,
  },
  dbTypeTagText: { fontSize: 11, fontWeight: '700', color: colors.blue },
  dbMetaGrid: {
    flexDirection: 'row',
    gap: 12,
    backgroundColor: '#f8fafc',
    padding: 8,
    borderRadius: 8,
  },
  dbMetaItem: { flex: 1 },
  dbMetaLabel: { fontSize: 10, color: colors.muted, textTransform: 'uppercase' },
  dbMetaVal: { fontSize: 13, fontWeight: '700', color: colors.navy },
  dbTokenBar: {
    flexDirection: 'row',
    alignItems: 'center',
    borderTopWidth: 1,
    borderTopColor: '#f1f5f9',
    paddingTop: 6,
  },
  dbTokenLabel: { fontSize: 10, fontWeight: '700', color: colors.muted },
  dbTokenText: { fontSize: 11, fontWeight: '700', color: colors.blue, letterSpacing: 0.5 },

  // Report Styles
  filterPillsRow: {
    flexDirection: 'row',
    gap: 8,
    marginVertical: 4,
    flexWrap: 'wrap',
  },
  filterPill: {
    paddingVertical: 7,
    paddingHorizontal: 14,
    borderRadius: 20,
    backgroundColor: colors.white,
    borderWidth: 1,
    borderColor: colors.border,
  },
  filterPillActive: {
    backgroundColor: colors.navy,
    borderColor: colors.navy,
  },
  filterPillText: { fontSize: 12, fontWeight: '600', color: colors.muted },
  filterPillTextActive: { color: colors.white, fontWeight: '700' },

  reportCard: {
    backgroundColor: colors.white,
    borderRadius: 16,
    padding: 16,
    borderWidth: 1,
    borderColor: colors.border,
    gap: 10,
  },
  reportTopRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
  },
  reportPlate: { fontSize: 16, fontWeight: '800', color: colors.navy },
  reportType: { fontSize: 13, fontWeight: '600', color: colors.blue, marginTop: 2 },
  statusBadge: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 12,
  },
  statusBadgeOpen: { backgroundColor: colors.redBg },
  statusBadgeAck: { backgroundColor: colors.amberBg },
  statusBadgeResolved: { backgroundColor: colors.greenBg },
  statusBadgeText: { fontSize: 11, fontWeight: '700' },
  statusTextOpen: { color: colors.red },
  statusTextAck: { color: colors.amber },
  statusTextResolved: { color: colors.green },

  reportDesc: { fontSize: 13, color: '#334155', lineHeight: 19 },
  reportImageBox: {
    borderRadius: 12,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: '#0f172a',
    marginTop: 4,
  },
  reportImage: {
    width: '100%',
    height: 180,
  },
  gpsLinkBox: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#f0fdf4',
    borderWidth: 1,
    borderColor: '#bbf7d0',
    padding: 10,
    borderRadius: 10,
    gap: 8,
    marginTop: 2,
  },
  gpsLinkIcon: { fontSize: 16 },
  gpsLinkTitle: { fontSize: 12, fontWeight: '700', color: '#166534' },
  gpsLinkSub: { fontSize: 11, color: '#15803d', marginTop: 1 },
  gpsLinkArrow: { fontSize: 14, fontWeight: '800', color: '#166534' },
  reportFooter: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    borderTopWidth: 1,
    borderTopColor: '#f1f5f9',
    paddingTop: 8,
  },
  reportMeta: { fontSize: 11, color: colors.muted },

  reportActions: {
    backgroundColor: '#f8fafc',
    borderRadius: 10,
    padding: 10,
    gap: 8,
    borderWidth: 1,
    borderColor: colors.border,
  },
  actionPromptText: { fontSize: 12, fontWeight: '700', color: colors.navy },
  reportActionBtn: {
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.white,
    paddingVertical: 6,
    paddingHorizontal: 10,
    borderRadius: 8,
  },
  reportActionBtnText: { fontSize: 12, fontWeight: '700', color: colors.navy },

  emptyCard: {
    backgroundColor: colors.white,
    borderRadius: 16,
    padding: 32,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: 'center',
    gap: 8,
  },
  emptyTitle: { fontSize: 18, fontWeight: '800', color: colors.navy },
  emptySub: { fontSize: 13, color: colors.muted, textAlign: 'center', marginBottom: 8 },

  // Large QR Modal
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(15, 23, 42, 0.75)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
  },
  qrModalCard: {
    backgroundColor: colors.white,
    borderRadius: 24,
    padding: 24,
    alignItems: 'center',
    width: '100%',
    maxWidth: 340,
    gap: 6,
  },
  qrModalTitle: { fontSize: 18, fontWeight: '800', color: colors.navy },
  qrModalPlate: { fontSize: 20, fontWeight: '800', color: colors.blue },
  qrModalSub: { fontSize: 13, color: colors.muted },
  qrBoxLarge: {
    backgroundColor: '#ffffff',
    padding: 16,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: colors.border,
    marginVertical: 14,
  },
  qrTokenDisplay: { fontSize: 13, fontWeight: '800', color: colors.navy, letterSpacing: 0.5 },
  qrInstruction: {
    fontSize: 12,
    color: colors.muted,
    textAlign: 'center',
    lineHeight: 17,
    paddingHorizontal: 8,
  },

  // Modal Input
  modalContent: { backgroundColor: colors.white, borderRadius: 16, padding: 20, gap: 10, width: '100%' },
  modalTitle: { fontSize: 18, fontWeight: '800', color: colors.navy },
  modalSubtitle: { fontSize: 13, color: colors.muted, lineHeight: 18 },
  modalInput: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 8,
    padding: 12,
    fontSize: 14,
    backgroundColor: '#f8fafc',
  },
});
