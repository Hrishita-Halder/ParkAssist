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
  ActivityIndicator,
  Linking
} from 'react-native';
import { StatusBar } from 'expo-status-bar';

const DEFAULT_API_URL = process.env.EXPO_PUBLIC_API_URL || 'http://172.20.10.2:5000/api';

const colors = {
  navy: '#0f172a',
  navyCard: '#1e293b',
  crimson: '#dc2626',
  crimsonBg: '#fef2f2',
  blue: '#2563eb',
  blueBg: '#eff6ff',
  green: '#16a34a',
  greenBg: '#f0fdf4',
  amber: '#d97706',
  amberBg: '#fffbeb',
  bg: '#f8fafc',
  card: '#ffffff',
  muted: '#64748b',
  border: '#e2e8f0',
  white: '#ffffff',
};

export default function App() {
  const [apiUrl, setApiUrl] = useState(DEFAULT_API_URL);
  const [showConfig, setShowConfig] = useState(false);
  const [loading, setLoading] = useState(false);

  // Auth State
  const [isLoggedIn, setIsLoggedIn] = useState(false);
  const [token, setToken] = useState('');
  const [adminUser, setAdminUser] = useState(null);
  const [adminEmail, setAdminEmail] = useState('admin@parkassist.local');
  const [adminPassword, setAdminPassword] = useState('ChangeMe123!');

  // Navigation tab: 'dashboard' | 'vehicles' | 'incidents' | 'users'
  const [tab, setTab] = useState('dashboard');

  // Admin Data State
  const [stats, setStats] = useState({
    total_users: 0,
    total_vehicles: 0,
    total_incidents: 0,
    open_incidents: 0,
    resolved_incidents: 0,
  });
  const [vehicles, setVehicles] = useState([]);
  const [incidents, setIncidents] = useState([]);
  const [users, setUsers] = useState([]);

  // Search Filter
  const [searchQuery, setSearchQuery] = useState('');

  // API helper
  async function apiCall(endpoint, method = 'GET', body = null) {
    const cleanBase = apiUrl.replace(/\/+$/, '');
    const headers = { 'Content-Type': 'application/json' };
    if (token) headers['Authorization'] = `Bearer ${token}`;

    const config = { method, headers };
    if (body) config.body = JSON.stringify(body);

    const res = await fetch(`${cleanBase}${endpoint}`, config);
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      throw new Error(data.error || `HTTP ${res.status}`);
    }
    return data;
  }

  // Load All Admin Data
  async function fetchAllAdminData() {
    try {
      setLoading(true);
      const [sData, vData, iData, uData] = await Promise.all([
        apiCall('/admin/stats').catch(() => null),
        apiCall('/admin/vehicles').catch(() => ({ vehicles: [] })),
        apiCall('/admin/incidents').catch(() => ({ incidents: [] })),
        apiCall('/admin/users').catch(() => ({ users: [] })),
      ]);

      if (sData) setStats(sData);
      setVehicles(vData.vehicles || []);
      setIncidents(iData.incidents || []);
      setUsers(uData.users || []);
    } catch (err) {
      Alert.alert('Data Sync Error', err.message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (isLoggedIn) {
      fetchAllAdminData();
    }
  }, [isLoggedIn, tab]);

  // Auth Handler
  const handleAdminLogin = async () => {
    if (!adminEmail.trim() || !adminPassword.trim()) {
      Alert.alert('Required Fields', 'Please enter admin email and password.');
      return;
    }

    try {
      setLoading(true);
      const res = await apiCall('/auth/login', 'POST', {
        email: adminEmail.trim(),
        password: adminPassword.trim(),
      });

      if (res.user.role !== 'admin') {
        Alert.alert('Access Denied', 'This account does not have administrator privileges.');
        return;
      }

      setToken(res.token);
      setAdminUser(res.user);
      setIsLoggedIn(true);
      setTab('dashboard');
    } catch (err) {
      Alert.alert(
        'Login Failed',
        `${err.message}\n\nMake sure the backend is running at:\n${apiUrl}`
      );
    } finally {
      setLoading(false);
    }
  };

  const handleAdminLogout = () => {
    Alert.alert('Log Out', 'Exit administrator console?', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Log Out',
        style: 'destructive',
        onPress: () => {
          setIsLoggedIn(false);
          setToken('');
          setAdminUser(null);
          setVehicles([]);
          setIncidents([]);
          setUsers([]);
        },
      },
    ]);
  };

  // Deletion Handlers
  const handleDeleteVehicle = (id, plate) => {
    Alert.alert(
      '⚠️ Purge Vehicle Record',
      `Permanently delete vehicle "${plate}" and all its reported incidents from MongoDB?`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete Permanently',
          style: 'destructive',
          onPress: async () => {
            try {
              setLoading(true);
              await apiCall(`/admin/vehicles/${id}`, 'DELETE');
              Alert.alert('Success', `Vehicle ${plate} has been permanently deleted.`);
              fetchAllAdminData();
            } catch (err) {
              Alert.alert('Deletion Error', err.message);
            } finally {
              setLoading(false);
            }
          },
        },
      ]
    );
  };

  const handleDeleteIncident = (id) => {
    Alert.alert(
      '⚠️ Purge Incident Report',
      'Permanently delete this incident report from the database?',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            try {
              setLoading(true);
              await apiCall(`/admin/incidents/${id}`, 'DELETE');
              Alert.alert('Success', 'Incident report removed.');
              fetchAllAdminData();
            } catch (err) {
              Alert.alert('Deletion Error', err.message);
            } finally {
              setLoading(false);
            }
          },
        },
      ]
    );
  };

  const handleDeleteUser = (id, email) => {
    Alert.alert(
      '🚨 CRITICAL: Delete User Account',
      `Permanently delete user "${email}"?\n\nThis will trigger a cascade delete of all their registered vehicles and all their incident reports!`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete User & All Data',
          style: 'destructive',
          onPress: async () => {
            try {
              setLoading(true);
              const res = await apiCall(`/admin/users/${id}`, 'DELETE');
              Alert.alert('Purge Complete', res.message);
              fetchAllAdminData();
            } catch (err) {
              Alert.alert('Deletion Error', err.message);
            } finally {
              setLoading(false);
            }
          },
        },
      ]
    );
  };

  // Header Component
  const Header = () => (
    <View style={styles.header}>
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
          <View style={styles.headerIcon}>
            <Text style={{ fontSize: 18 }}>🛡️</Text>
          </View>
          <View>
            <Text style={styles.headerTitle}>ParkAssist Admin</Text>
            <Text style={styles.headerSubtitle}>Database Purge & Governance</Text>
          </View>
        </View>

        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
          <Pressable onPress={() => setShowConfig(true)} style={styles.ipBadge}>
            <Text style={styles.ipBadgeText}>⚙ IP</Text>
          </Pressable>
          {isLoggedIn && (
            <Pressable onPress={handleAdminLogout} style={styles.logoutBtn}>
              <Text style={styles.logoutBtnText}>Exit</Text>
            </Pressable>
          )}
        </View>
      </View>
    </View>
  );

  // Bottom Navigation Bar
  const BottomNav = () => {
    if (!isLoggedIn) return null;
    const navItems = [
      { key: 'dashboard', label: 'Metrics', icon: '📊' },
      { key: 'vehicles', label: `Vehicles (${vehicles.length})`, icon: '🚗' },
      { key: 'incidents', label: `Reports (${incidents.length})`, icon: '⚠️' },
      { key: 'users', label: `Users (${users.length})`, icon: '👥' },
    ];

    return (
      <View style={styles.bottomNav}>
        {navItems.map((item) => {
          const isActive = tab === item.key;
          return (
            <Pressable
              key={item.key}
              onPress={() => setTab(item.key)}
              style={[styles.navItem, isActive && styles.navItemActive]}
            >
              <Text style={styles.navIcon}>{item.icon}</Text>
              <Text style={[styles.navText, isActive && styles.navTextActive]}>{item.label}</Text>
            </Pressable>
          );
        })}
      </View>
    );
  };

  // ==========================================
  // VIEW: LOGIN SCREEN
  // ==========================================
  if (!isLoggedIn) {
    return (
      <View style={styles.safe}>
        <StatusBar style="light" backgroundColor={colors.navy} />
        <Header />
        <ScrollView contentContainerStyle={styles.loginContainer} keyboardShouldPersistTaps="handled">
          <View style={styles.loginCard}>
            <View style={{ alignItems: 'center', marginBottom: 16 }}>
              <View style={styles.loginIconBadge}>
                <Text style={{ fontSize: 32 }}>🔒</Text>
              </View>
              <Text style={styles.loginTitle}>Admin Authentication</Text>
              <Text style={styles.loginSubtitle}>
                Access platform metrics, manage database records, and execute data purges.
              </Text>
            </View>

            <View style={styles.field}>
              <Text style={styles.label}>Administrator Email</Text>
              <TextInput
                style={styles.input}
                placeholder="admin@parkassist.local"
                value={adminEmail}
                onChangeText={setAdminEmail}
                keyboardType="email-address"
                autoCapitalize="none"
              />
            </View>

            <View style={styles.field}>
              <Text style={styles.label}>Admin Password</Text>
              <TextInput
                style={styles.input}
                placeholder="••••••••"
                value={adminPassword}
                onChangeText={setAdminPassword}
                secureTextEntry
              />
            </View>

            <Pressable style={styles.dangerButton} onPress={handleAdminLogin} disabled={loading}>
              {loading ? (
                <ActivityIndicator color="#fff" />
              ) : (
                <Text style={styles.dangerButtonText}>Authorize Admin Access</Text>
              )}
            </Pressable>

            <Text style={styles.loginNote}>
              Credentials default to ADMIN_EMAIL and ADMIN_PASSWORD in backend/.env
            </Text>
          </View>
        </ScrollView>
      </View>
    );
  }

  // ==========================================
  // VIEW 1: METRICS DASHBOARD
  // ==========================================
  const renderDashboard = () => (
    <ScrollView contentContainerStyle={styles.pageScroll}>
      <View style={styles.adminBanner}>
        <Text style={styles.adminGreeting}>System Governance Mode</Text>
        <Text style={styles.adminName}>{adminUser?.name || 'Administrator'}</Text>
        <Text style={styles.adminEmail}>{adminUser?.email}</Text>
      </View>

      <Text style={styles.sectionHeader}>Platform Database Counters</Text>

      <View style={styles.statsGrid}>
        <Pressable style={styles.statCard} onPress={() => setTab('users')}>
          <Text style={styles.statIcon}>👥</Text>
          <Text style={styles.statNumber}>{stats.total_users || 0}</Text>
          <Text style={styles.statLabel}>Registered Users</Text>
        </Pressable>

        <Pressable style={styles.statCard} onPress={() => setTab('vehicles')}>
          <Text style={styles.statIcon}>🚗</Text>
          <Text style={[styles.statNumber, { color: colors.blue }]}>{stats.total_vehicles || 0}</Text>
          <Text style={styles.statLabel}>Vehicles in DB</Text>
        </Pressable>

        <Pressable style={styles.statCard} onPress={() => setTab('incidents')}>
          <Text style={styles.statIcon}>⚠️</Text>
          <Text style={[styles.statNumber, { color: colors.amber }]}>{stats.open_incidents || 0}</Text>
          <Text style={styles.statLabel}>Open Reports</Text>
        </Pressable>

        <Pressable style={styles.statCard} onPress={() => setTab('incidents')}>
          <Text style={styles.statIcon}>✅</Text>
          <Text style={[styles.statNumber, { color: colors.green }]}>{stats.resolved_incidents || 0}</Text>
          <Text style={styles.statLabel}>Resolved Reports</Text>
        </Pressable>
      </View>

      {/* Quick Navigation Cards */}
      <View style={styles.quickCard}>
        <Text style={styles.quickCardTitle}>Data Moderation Quick Actions</Text>
        <View style={{ gap: 8, marginTop: 10 }}>
          <Pressable style={styles.quickActionRow} onPress={() => setTab('vehicles')}>
            <Text style={{ fontSize: 18 }}>🚗</Text>
            <View style={{ flex: 1 }}>
              <Text style={styles.quickActionLabel}>Manage & Purge Vehicles</Text>
              <Text style={styles.quickActionSub}>Review all active windshield QR tokens and delete records</Text>
            </View>
            <Text style={{ color: colors.muted }}>→</Text>
          </Pressable>

          <Pressable style={styles.quickActionRow} onPress={() => setTab('incidents')}>
            <Text style={{ fontSize: 18 }}>⚠️</Text>
            <View style={{ flex: 1 }}>
              <Text style={styles.quickActionLabel}>Moderate Incident Alerts</Text>
              <Text style={styles.quickActionSub}>Inspect photos, GPS locations, and delete spam reports</Text>
            </View>
            <Text style={{ color: colors.muted }}>→</Text>
          </Pressable>

          <Pressable style={styles.quickActionRow} onPress={() => setTab('users')}>
            <Text style={{ fontSize: 18 }}>👥</Text>
            <View style={{ flex: 1 }}>
              <Text style={styles.quickActionLabel}>Manage User Accounts</Text>
              <Text style={styles.quickActionSub}>Cascade delete accounts and associated data</Text>
            </View>
            <Text style={{ color: colors.muted }}>→</Text>
          </Pressable>
        </View>
      </View>
    </ScrollView>
  );

  // ==========================================
  // VIEW 2: VEHICLES MANAGEMENT
  // ==========================================
  const renderVehicles = () => {
    const filtered = vehicles.filter(
      (v) =>
        v.registration_number?.toLowerCase().includes(searchQuery.toLowerCase()) ||
        v.make?.toLowerCase().includes(searchQuery.toLowerCase()) ||
        v.model?.toLowerCase().includes(searchQuery.toLowerCase()) ||
        v.token?.toLowerCase().includes(searchQuery.toLowerCase()) ||
        v.owner_email?.toLowerCase().includes(searchQuery.toLowerCase())
    );

    return (
      <ScrollView contentContainerStyle={styles.pageScroll} keyboardShouldPersistTaps="handled">
        <View style={styles.searchContainer}>
          <TextInput
            style={styles.searchInput}
            placeholder="Search plate, make, model, owner, or token..."
            value={searchQuery}
            onChangeText={setSearchQuery}
          />
        </View>

        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
          <Text style={styles.sectionHeader}>Registered Vehicles ({filtered.length})</Text>
          <Pressable onPress={fetchAllAdminData}>
            <Text style={{ fontSize: 12, fontWeight: '700', color: colors.blue }}>🔄 Refresh</Text>
          </Pressable>
        </View>

        {filtered.length === 0 ? (
          <View style={styles.emptyCard}>
            <Text style={styles.emptyTitle}>No matching vehicles</Text>
          </View>
        ) : (
          filtered.map((v) => (
            <View key={v.id} style={styles.itemCard}>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.itemPlate}>{v.registration_number}</Text>
                  <Text style={styles.itemSub}>
                    {v.make} {v.model} ({v.year || '2024'}) • {v.color || 'Standard'}
                  </Text>
                  <Text style={styles.itemMeta}>Owner: {v.owner_email || '—'}</Text>
                  <Text style={styles.itemToken}>Token: {v.token}</Text>
                </View>
                <Pressable
                  onPress={() => handleDeleteVehicle(v.id, v.registration_number)}
                  style={styles.deleteBtn}
                >
                  <Text style={styles.deleteBtnText}>🗑️ Delete</Text>
                </Pressable>
              </View>
            </View>
          ))
        )}
      </ScrollView>
    );
  };

  // ==========================================
  // VIEW 3: INCIDENTS MANAGEMENT
  // ==========================================
  const renderIncidents = () => (
    <ScrollView contentContainerStyle={styles.pageScroll} keyboardShouldPersistTaps="handled">
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
        <Text style={styles.sectionHeader}>Incident Reports ({incidents.length})</Text>
        <Pressable onPress={fetchAllAdminData}>
          <Text style={{ fontSize: 12, fontWeight: '700', color: colors.blue }}>🔄 Refresh</Text>
        </Pressable>
      </View>

      {incidents.length === 0 ? (
        <View style={styles.emptyCard}>
          <Text style={styles.emptyTitle}>No incident reports found</Text>
        </View>
      ) : (
        incidents.map((inc) => (
          <View key={inc.id} style={styles.itemCard}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' }}>
              <View style={{ flex: 1 }}>
                <Text style={styles.itemPlate}>{inc.reg_number || 'Registered Vehicle'}</Text>
                <Text style={{ fontSize: 13, fontWeight: '700', color: colors.crimson, marginTop: 2 }}>
                  {inc.type}
                </Text>
                <Text style={[styles.itemSub, { marginTop: 4, fontStyle: 'italic' }]}>
                  "{inc.description}"
                </Text>
                <Text style={styles.itemMeta}>📍 Location: {inc.location || 'Nearby'}</Text>
                {inc.coordinates && inc.coordinates.latitude && (
                  <Pressable
                    onPress={() => {
                      const url = `https://www.google.com/maps/search/?api=1&query=${inc.coordinates.latitude},${inc.coordinates.longitude}`;
                      Linking.openURL(url);
                    }}
                    style={{ marginTop: 2 }}
                  >
                    <Text style={{ fontSize: 11, color: colors.green, fontWeight: '700' }}>
                      📍 GPS: {inc.coordinates.latitude}, {inc.coordinates.longitude} (Open Maps)
                    </Text>
                  </Pressable>
                )}
                <View style={{ marginTop: 6 }}>
                  <Text style={[styles.statusBadge, inc.status === 'Open' ? styles.statusOpen : styles.statusResolved]}>
                    Status: {inc.status}
                  </Text>
                </View>
              </View>
              <Pressable onPress={() => handleDeleteIncident(inc.id)} style={styles.deleteBtn}>
                <Text style={styles.deleteBtnText}>🗑️ Delete</Text>
              </Pressable>
            </View>
          </View>
        ))
      )}
    </ScrollView>
  );

  // ==========================================
  // VIEW 4: USERS MANAGEMENT
  // ==========================================
  const renderUsers = () => (
    <ScrollView contentContainerStyle={styles.pageScroll} keyboardShouldPersistTaps="handled">
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
        <Text style={styles.sectionHeader}>Registered User Accounts ({users.length})</Text>
        <Pressable onPress={fetchAllAdminData}>
          <Text style={{ fontSize: 12, fontWeight: '700', color: colors.blue }}>🔄 Refresh</Text>
        </Pressable>
      </View>

      {users.length === 0 ? (
        <View style={styles.emptyCard}>
          <Text style={styles.emptyTitle}>No users found</Text>
        </View>
      ) : (
        users.map((u) => (
          <View key={u.id} style={styles.itemCard}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
              <View style={{ flex: 1 }}>
                <Text style={styles.itemPlate}>{u.name || 'User'}</Text>
                <Text style={styles.itemSub}>{u.email}</Text>
                <Text style={styles.itemMeta}>Phone: {u.phone || '—'} • Role: {u.role}</Text>
              </View>
              {u.role !== 'admin' ? (
                <Pressable
                  onPress={() => handleDeleteUser(u.id, u.email)}
                  style={[styles.deleteBtn, { backgroundColor: '#fee2e2' }]}
                >
                  <Text style={[styles.deleteBtnText, { color: colors.crimson }]}>
                    🗑️ Purge User
                  </Text>
                </Pressable>
              ) : (
                <Text style={{ fontSize: 11, color: colors.muted, fontStyle: 'italic' }}>Protected</Text>
              )}
            </View>
          </View>
        ))
      )}
    </ScrollView>
  );

  return (
    <View style={styles.safe}>
      <StatusBar style="light" backgroundColor={colors.navy} />
      <Header />

      <View style={{ flex: 1, backgroundColor: colors.bg }}>
        {tab === 'dashboard' && renderDashboard()}
        {tab === 'vehicles' && renderVehicles()}
        {tab === 'incidents' && renderIncidents()}
        {tab === 'users' && renderUsers()}
      </View>

      <BottomNav />

      {/* IP Config Modal */}
      <Modal visible={showConfig} animationType="slide" transparent>
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <Text style={styles.modalTitle}>Backend API Endpoint</Text>
            <Text style={styles.modalSubtitle}>
              Connect this Admin App to your computer's IP address:
            </Text>
            <TextInput
              style={styles.modalInput}
              value={apiUrl}
              onChangeText={setApiUrl}
              autoCapitalize="none"
              autoCorrect={false}
              placeholder="http://10.3.5.91:5000/api"
            />
            <View style={{ gap: 8, marginTop: 12 }}>
              <Pressable
                style={styles.dangerButton}
                onPress={() => {
                  setShowConfig(false);
                  if (isLoggedIn) fetchAllAdminData();
                }}
              >
                <Text style={styles.dangerButtonText}>Save & Reconnect</Text>
              </Pressable>
              <Pressable
                style={{ padding: 12, alignItems: 'center' }}
                onPress={() => setShowConfig(false)}
              >
                <Text style={{ color: colors.muted, fontWeight: '700' }}>Cancel</Text>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>
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
    borderBottomColor: '#1e293b',
  },
  headerIcon: {
    width: 36,
    height: 36,
    borderRadius: 10,
    backgroundColor: colors.crimson,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerTitle: { fontSize: 19, fontWeight: '900', color: colors.white },
  headerSubtitle: { fontSize: 11, color: '#94a3b8', marginTop: 1 },
  ipBadge: {
    backgroundColor: '#1e293b',
    borderWidth: 1,
    borderColor: '#334155',
    paddingVertical: 5,
    paddingHorizontal: 9,
    borderRadius: 8,
  },
  ipBadgeText: { color: '#93c5fd', fontSize: 11, fontWeight: '700' },
  logoutBtn: {
    backgroundColor: '#334155',
    paddingVertical: 5,
    paddingHorizontal: 11,
    borderRadius: 8,
  },
  logoutBtnText: { color: '#f8fafc', fontSize: 11, fontWeight: '700' },

  // Bottom Navigation Bar
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
  navItem: { flex: 1, alignItems: 'center', paddingVertical: 4, borderRadius: 8 },
  navItemActive: { backgroundColor: colors.crimsonBg },
  navIcon: { fontSize: 18, marginBottom: 2 },
  navText: { fontSize: 10, fontWeight: '600', color: colors.muted },
  navTextActive: { color: colors.crimson, fontWeight: '800' },

  // Page Scroll
  pageScroll: { padding: 16, paddingBottom: 90, gap: 14 },

  // Login Screen
  loginContainer: { flexGrow: 1, justifyContent: 'center', padding: 20, backgroundColor: colors.bg },
  loginCard: {
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
  loginIconBadge: {
    width: 60,
    height: 60,
    borderRadius: 30,
    backgroundColor: colors.crimsonBg,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 8,
  },
  loginTitle: { fontSize: 22, fontWeight: '900', color: colors.navy },
  loginSubtitle: { fontSize: 13, color: colors.muted, textAlign: 'center', marginTop: 4 },
  loginNote: { fontSize: 11, color: colors.muted, textAlign: 'center', marginTop: 8 },

  field: { gap: 6 },
  label: { fontSize: 12, fontWeight: '800', color: colors.navy, textTransform: 'uppercase' },
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
  dangerButton: {
    backgroundColor: colors.crimson,
    paddingVertical: 14,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 4,
  },
  dangerButtonText: { color: colors.white, fontSize: 15, fontWeight: '800' },

  // Dashboard Styles
  adminBanner: {
    backgroundColor: colors.navy,
    borderRadius: 16,
    padding: 18,
    shadowColor: '#000',
    shadowOpacity: 0.1,
    shadowRadius: 6,
  },
  adminGreeting: { fontSize: 12, color: '#fca5a5', fontWeight: '700', textTransform: 'uppercase' },
  adminName: { fontSize: 22, fontWeight: '900', color: colors.white, marginTop: 2 },
  adminEmail: { fontSize: 12, color: '#cbd5e1', marginTop: 2 },

  sectionHeader: { fontSize: 16, fontWeight: '900', color: colors.navy },
  statsGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  statCard: {
    width: '48%',
    backgroundColor: colors.white,
    borderRadius: 14,
    padding: 14,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: 'center',
  },
  statIcon: { fontSize: 22, marginBottom: 4 },
  statNumber: { fontSize: 24, fontWeight: '900', color: colors.navy },
  statLabel: { fontSize: 11, color: colors.muted, fontWeight: '600', marginTop: 2 },

  quickCard: {
    backgroundColor: colors.white,
    borderRadius: 16,
    padding: 16,
    borderWidth: 1,
    borderColor: colors.border,
  },
  quickCardTitle: { fontSize: 15, fontWeight: '800', color: colors.navy },
  quickActionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 10,
    borderRadius: 10,
    backgroundColor: colors.bg,
    gap: 10,
  },
  quickActionLabel: { fontSize: 13, fontWeight: '700', color: colors.navy },
  quickActionSub: { fontSize: 11, color: colors.muted, marginTop: 1 },

  // Search
  searchContainer: {
    backgroundColor: colors.white,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: 12,
  },
  searchInput: { paddingVertical: 10, fontSize: 13, color: colors.navy },

  // Item Cards
  itemCard: {
    backgroundColor: colors.white,
    borderRadius: 14,
    padding: 14,
    borderWidth: 1,
    borderColor: colors.border,
    gap: 8,
  },
  itemPlate: { fontSize: 16, fontWeight: '900', color: colors.navy },
  itemSub: { fontSize: 13, color: '#334155', marginTop: 2 },
  itemMeta: { fontSize: 11, color: colors.muted, marginTop: 2 },
  itemToken: { fontSize: 11, fontWeight: '800', color: colors.blue, marginTop: 2, fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace' },

  deleteBtn: {
    backgroundColor: colors.crimsonBg,
    borderWidth: 1,
    borderColor: '#fca5a5',
    paddingVertical: 6,
    paddingHorizontal: 10,
    borderRadius: 8,
  },
  deleteBtnText: { color: colors.crimson, fontSize: 11, fontWeight: '800' },

  statusBadge: { fontSize: 10, fontWeight: '800', paddingVertical: 2, paddingHorizontal: 6, borderRadius: 4, alignSelf: 'flex-start' },
  statusOpen: { backgroundColor: colors.crimsonBg, color: colors.crimson },
  statusResolved: { backgroundColor: colors.greenBg, color: colors.green },

  emptyCard: {
    backgroundColor: colors.white,
    borderRadius: 14,
    padding: 24,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: colors.border,
  },
  emptyTitle: { fontSize: 14, fontWeight: '700', color: colors.muted },

  // Modal
  modalOverlay: { flex: 1, backgroundColor: 'rgba(15, 23, 42, 0.75)', justifyContent: 'center', padding: 20 },
  modalContent: { backgroundColor: colors.white, borderRadius: 16, padding: 20, gap: 10 },
  modalTitle: { fontSize: 18, fontWeight: '900', color: colors.navy },
  modalSubtitle: { fontSize: 13, color: colors.muted, lineHeight: 18 },
  modalInput: { borderWidth: 1, borderColor: colors.border, borderRadius: 8, padding: 12, fontSize: 14, backgroundColor: '#f8fafc' },
});

