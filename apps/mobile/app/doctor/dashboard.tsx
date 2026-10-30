import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  SafeAreaView,
  FlatList,
  ActivityIndicator,
} from 'react-native';
import { useRouter, useFocusEffect } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { api } from '../../utils/apiClient';
import { useSession } from '@/contexts/SessionContext';
import { ACCESSIBLE_COLORS } from '../../theme/accessibility';
import {
  DashboardCounters,
  DashboardPatient,
  DashboardResponse,
  SeverityFilter,
  StatusFilter,
  buildDashboardQuery,
  formatGestationalAge,
  getAlertBadge,
  mergeDashboardPages,
} from '../../utils/doctorDashboard';

// Lista simples do admin: o dashboard por gravidade (E3-10) é só para médico,
// porque o acesso do admin depende do procedimento auditado da #69.
type AdminPatient = {
  pregnant_id: string;
  patient_name: string;
  semanas_gestacao: number | null;
};

const EMPTY_COUNTERS: DashboardCounters = { vermelho: 0, amarelo: 0, sem_alerta: 0, nao_reconhecidos: 0 };

export default function DashboardScreen() {
  const router = useRouter();
  const { user, signOut } = useSession();
  const doctorName = user?.name ? `Dr. ${user.name.split(' ')[0]}` : 'Dr.';
  const isAdmin = user?.role === 'admin';

  const [patients, setPatients] = useState<DashboardPatient[]>([]);
  const [adminPatients, setAdminPatients] = useState<AdminPatient[]>([]);
  const [counters, setCounters] = useState<DashboardCounters>(EMPTY_COUNTERS);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(0);
  const [severity, setSeverity] = useState<SeverityFilter>(null);
  const [status, setStatus] = useState<StatusFilter>(null);
  const [searchInput, setSearchInput] = useState('');
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const requestId = useRef(0);

  const loadDashboard = useCallback(async (nextPage: number) => {
    const currentRequest = ++requestId.current;
    if (nextPage === 1) setLoading(true);
    else setLoadingMore(true);

    try {
      if (isAdmin) {
        const response = await api.get(`/pregnants?_=${Date.now()}`);
        if (currentRequest !== requestId.current) return;
        setAdminPatients(response.data);
      } else {
        const query = buildDashboardQuery({ gravidade: severity, status, busca: search, pagina: nextPage });
        const response = await api.get<DashboardResponse>(`/doctors/me/dashboard${query}`);
        if (currentRequest !== requestId.current) return;
        const data = response.data;
        setCounters(data.contadores);
        setTotalPages(data.total_paginas);
        setPage(data.pagina);
        setPatients((current) => (nextPage === 1 ? data.pacientes : mergeDashboardPages(current, data.pacientes)));
      }
      setError(null);
    } catch (e) {
      if (currentRequest !== requestId.current) return;
      setError(e instanceof Error ? e.message : 'Erro de rede');
    } finally {
      if (currentRequest === requestId.current) {
        setLoading(false);
        setLoadingMore(false);
      }
    }
  }, [isAdmin, severity, status, search]);

  // Atualiza ao abrir a tela (decisão do P.O.: ao abrir + botão manual, sem tempo real).
  useFocusEffect(
    useCallback(() => {
      loadDashboard(1);
    }, [loadDashboard])
  );

  // Aplica a busca por nome depois que a pessoa para de digitar.
  useEffect(() => {
    const timer = setTimeout(() => setSearch(searchInput), 400);
    return () => clearTimeout(timer);
  }, [searchInput]);

  const toggleSeverity = (value: Exclude<SeverityFilter, null>) => {
    setSeverity((current) => (current === value ? null : value));
  };

  const toggleStatus = (value: Exclude<StatusFilter, null>) => {
    setStatus((current) => (current === value ? null : value));
  };

  const handlePatientPress = (patientId: string | number) => {
    router.push(`/doctor/${patientId}/identificacao`);
  };

  const handleAlertPress = (patientId: string | number) => {
    router.push(`/doctor/${patientId}/alertas` as any);
  };

  const handleSignOut = async () => {
    await signOut();
    router.replace('/login');
  };

  const renderFilterChip = (
    key: string,
    label: string,
    icon: React.ComponentProps<typeof Ionicons>['name'],
    color: string,
    selected: boolean,
    onPress: () => void
  ) => (
    <TouchableOpacity
      key={key}
      onPress={onPress}
      style={[styles.chip, selected && { borderColor: color, backgroundColor: '#FFFFFF' }]}
      accessibilityRole="button"
      accessibilityState={{ selected }}
      accessibilityLabel={`${label}${selected ? ', filtro ativo' : ''}`}
    >
      <Ionicons name={icon} size={16} color={color} />
      <Text style={[styles.chipText, { color }]}>{label}</Text>
    </TouchableOpacity>
  );

  const renderFilters = () => (
    <View>
      <View style={styles.chipRow}>
        {renderFilterChip('red', `Vermelho ${counters.vermelho}`, 'alert-circle', ACCESSIBLE_COLORS.danger, severity === 'red', () => toggleSeverity('red'))}
        {renderFilterChip('yellow', `Amarelo ${counters.amarelo}`, 'warning', ACCESSIBLE_COLORS.warning, severity === 'yellow', () => toggleSeverity('yellow'))}
        {renderFilterChip('none', `Sem alerta ${counters.sem_alerta}`, 'ellipse-outline', ACCESSIBLE_COLORS.success, severity === 'none', () => toggleSeverity('none'))}
      </View>
      <View style={styles.chipRow}>
        {renderFilterChip('pending', `Não reconhecidos ${counters.nao_reconhecidos}`, 'notifications', ACCESSIBLE_COLORS.body, status === 'pendente', () => toggleStatus('pendente'))}
        {renderFilterChip('acknowledged', 'Reconhecidos', 'checkmark-done-circle', ACCESSIBLE_COLORS.body, status === 'reconhecido', () => toggleStatus('reconhecido'))}
      </View>
    </View>
  );

  const renderPatientCard = ({ item }: { item: DashboardPatient }) => {
    const badge = getAlertBadge(item.pior_alerta);

    return (
      <TouchableOpacity
        style={styles.patientCard}
        onPress={() => handlePatientPress(item.pregnant_id)}
        accessibilityRole="button"
        accessibilityLabel={`${item.nome}. ${formatGestationalAge(item.ig_semanas)}. ${badge.accessibilityLabel}`}
      >
        <View style={{ flex: 1 }}>
          <Text style={styles.patientName}>{item.nome}</Text>
          <Text style={styles.patientWeeks}>{formatGestationalAge(item.ig_semanas)}</Text>
          <View style={styles.badgeRow}>
            <Ionicons name={badge.icon} size={16} color={badge.color} />
            <Text style={[styles.badgeText, { color: badge.color }]}>{badge.label}</Text>
          </View>
        </View>
        <TouchableOpacity
          onPress={() => handleAlertPress(item.pregnant_id)}
          style={styles.alertButton}
          accessibilityRole="button"
          accessibilityLabel={`Ver alertas de ${item.nome}`}
        >
          <Ionicons name="pulse-outline" size={22} color="#886aea" />
        </TouchableOpacity>
      </TouchableOpacity>
    );
  };

  const renderAdminCard = ({ item }: { item: AdminPatient }) => (
    <TouchableOpacity
      style={styles.patientCard}
      onPress={() => handlePatientPress(item.pregnant_id)}
      accessibilityRole="button"
      accessibilityLabel={`${item.patient_name}. ${formatGestationalAge(item.semanas_gestacao)}`}
    >
      <View style={{ flex: 1 }}>
        <Text style={styles.patientName}>{item.patient_name}</Text>
        <Text style={styles.patientWeeks}>{formatGestationalAge(item.semanas_gestacao)}</Text>
      </View>
      <TouchableOpacity
        onPress={() => handleAlertPress(item.pregnant_id)}
        style={styles.alertButton}
        accessibilityRole="button"
        accessibilityLabel={`Ver alertas de ${item.patient_name}`}
      >
        <Ionicons name="pulse-outline" size={22} color="#886aea" />
      </TouchableOpacity>
    </TouchableOpacity>
  );

  const renderFooter = () => {
    if (page >= totalPages) return null;
    if (loadingMore) return <ActivityIndicator color="#886aea" style={{ marginVertical: 16 }} />;
    return (
      <TouchableOpacity
        style={styles.loadMoreButton}
        onPress={() => loadDashboard(page + 1)}
        accessibilityRole="button"
      >
        <Text style={styles.loadMoreText}>Carregar mais</Text>
      </TouchableOpacity>
    );
  };

  const hasFilters = Boolean(severity || status || search.trim());

  const renderContent = () => {
    if (loading) return <ActivityIndicator size="large" color="#886aea" style={{ marginTop: 50 }} />;
    if (error) return <Text style={styles.errorText}>Erro: {error}</Text>;

    if (isAdmin) {
      if (adminPatients.length === 0) return <Text style={styles.emptyText}>Nenhum paciente encontrado.</Text>;
      return (
        <FlatList
          data={adminPatients}
          renderItem={renderAdminCard}
          keyExtractor={(item) => String(item.pregnant_id)}
          style={styles.list}
          showsVerticalScrollIndicator={false}
        />
      );
    }

    if (patients.length === 0) {
      return (
        <Text style={styles.emptyText}>
          {hasFilters ? 'Nenhuma paciente com esses filtros.' : 'Nenhuma paciente vinculada.'}
        </Text>
      );
    }

    return (
      <FlatList
        data={patients}
        renderItem={renderPatientCard}
        keyExtractor={(item) => String(item.pregnant_id)}
        style={styles.list}
        showsVerticalScrollIndicator={false}
        ListFooterComponent={renderFooter}
      />
    );
  };

  return (
    <SafeAreaView style={styles.safeArea}>
      <View style={styles.container}>
        <View style={styles.header}>
          <Text style={styles.headerTitle}>Olá {doctorName}!</Text>
          <View style={styles.headerActions}>
            {isAdmin && (
              <>
                <TouchableOpacity
                  onPress={() => router.push('/doctor/aprovacao-medicos')}
                  style={styles.headerActionButton}
                  accessibilityRole="button"
                  accessibilityLabel="Aprovar médicos"
                >
                  <Ionicons name="shield-checkmark-outline" size={26} color="#886aea" />
                </TouchableOpacity>
                <TouchableOpacity
                  onPress={() => router.push('/CadastroMedico')}
                  style={styles.headerActionButton}
                  accessibilityRole="button"
                  accessibilityLabel="Cadastrar médico"
                >
                  <Ionicons name="medkit-outline" size={26} color="#886aea" />
                </TouchableOpacity>
              </>
            )}
            <TouchableOpacity
              onPress={() => router.push('/doctor/vincular-paciente')}
              style={styles.headerActionButton}
              accessibilityRole="button"
              accessibilityLabel="Vincular paciente"
            >
              <Ionicons name="person-add-outline" size={26} color="#886aea" />
            </TouchableOpacity>
            <TouchableOpacity
              testID="e2e-doctor-refresh-dashboard"
              onPress={() => loadDashboard(1)}
              style={styles.headerActionButton}
              accessibilityRole="button"
              accessibilityLabel="Atualizar lista"
            >
              <Ionicons name="refresh-outline" size={26} color="#555" />
            </TouchableOpacity>
            <TouchableOpacity
              accessibilityLabel="Sobre o MyFetus"
              accessibilityRole="link"
              onPress={() => router.push('/sobre')}
              style={styles.headerActionButton}
            >
              <Ionicons name="information-circle-outline" size={28} color="#555" />
            </TouchableOpacity>
            <TouchableOpacity
              testID="e2e-doctor-my-data"
              accessibilityLabel="Meus dados"
              accessibilityRole="button"
              onPress={() => router.push('/meus-dados' as never)}
              style={styles.headerActionButton}
            >
              <Ionicons name="download-outline" size={26} color="#555" />
            </TouchableOpacity>
            <TouchableOpacity
              testID="e2e-doctor-sign-out"
              accessibilityLabel="Sair da conta"
              accessibilityRole="button"
              onPress={handleSignOut}
              style={styles.headerActionButton}
            >
              <Ionicons name="log-out-outline" size={28} color="#555" />
            </TouchableOpacity>
          </View>
        </View>
        <Text style={styles.subHeader}>Qual paciente você quer ver?</Text>
        {!isAdmin && (
          <>
            <View style={styles.searchContainer}>
              <Ionicons name="search-outline" size={20} color="#999" style={{ marginLeft: 10 }} />
              <TextInput
                placeholder="Buscar por nome..."
                style={styles.searchInput}
                placeholderTextColor="#999"
                value={searchInput}
                onChangeText={setSearchInput}
                maxLength={100}
                accessibilityLabel="Buscar paciente por nome"
              />
            </View>
            {renderFilters()}
          </>
        )}
        {renderContent()}
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: '#E6E0F8' },
  container: { flex: 1, paddingHorizontal: 20 },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 20 },
  headerActions: { flexDirection: 'row', alignItems: 'center' },
  headerActionButton: { marginLeft: 16 },
  headerTitle: { fontSize: 28, fontWeight: 'bold', color: '#333' },
  subHeader: { fontSize: 16, color: '#555', marginBottom: 15 },
  searchContainer: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#FFF', borderRadius: 25, height: 50, marginBottom: 12, elevation: 2 },
  searchInput: { flex: 1, height: '100%', paddingHorizontal: 10, fontSize: 16 },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 8 },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 18,
    borderWidth: 2,
    borderColor: 'transparent',
    backgroundColor: '#F4F1FD',
  },
  chipText: { fontSize: 14, fontWeight: '600' },
  list: { flex: 1, marginTop: 8 },
  patientCard: { backgroundColor: '#FFFFFF', borderRadius: 20, padding: 20, marginBottom: 15, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', elevation: 3 },
  patientName: { fontSize: 18, fontWeight: 'bold', color: '#b34d7a' },
  patientWeeks: { fontSize: 14, color: '#555', marginVertical: 4 },
  badgeRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  badgeText: { fontSize: 14, fontWeight: '600' },
  errorText: { textAlign: 'center', marginTop: 50, fontSize: 16, color: '#e74c3c' },
  emptyText: { textAlign: 'center', marginTop: 50, fontSize: 16, color: '#555' },
  loadMoreButton: { alignItems: 'center', paddingVertical: 14, marginBottom: 20 },
  loadMoreText: { fontSize: 16, fontWeight: '600', color: '#886aea' },
  alertButton: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: '#f0edff',
    justifyContent: 'center',
    alignItems: 'center',
  },
});
