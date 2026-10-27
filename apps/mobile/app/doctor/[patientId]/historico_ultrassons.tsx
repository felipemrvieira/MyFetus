import React from 'react';
import {
  Text,
  TouchableOpacity,
  StyleSheet,
  SafeAreaView,
  ScrollView,
  ActivityIndicator,
  Alert,
} from 'react-native';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { api } from '../../../utils/apiClient';
import FetalGrowthHistoryChart from '../../../components/FetalGrowthHistoryChart';
import { FetalBiometryRecord, normalizeFetalHistory } from '../../../utils/fetalHistory';

export default function UltrassonsScreen() {
  const router = useRouter();
  const { patientId } = useLocalSearchParams(); // Pega o ID do paciente
  const [records, setRecords] = React.useState<FetalBiometryRecord[]>([]);
  const [loading, setLoading] = React.useState(true);

  React.useEffect(() => {
    if (!patientId) return;

    const loadHistory = async () => {
      try {
        setLoading(true);
        const patient = await api.get(`/pregnants/${patientId}`);
        const pregnancyId = patient.data?.latest_pregnancy?.id;
        if (!pregnancyId) {
          setRecords([]);
          return;
        }
        const response = await api.get(`/history/pregnancies/${pregnancyId}/fetal-biometries`, {
          params: { order: 'asc', limit: 200 },
        });
        setRecords(normalizeFetalHistory(response.data));
      } catch {
        Alert.alert('Erro', 'Não foi possível carregar o histórico de ultrassons.');
      } finally {
        setLoading(false);
      }
    };

    loadHistory();
  }, [patientId]);

  const handleNext = () => router.push(`/doctor/${patientId}/historico_exames`);

  return (
    <SafeAreaView style={styles.safeArea}>
      <ScrollView contentContainerStyle={styles.container}>
        {loading ? <ActivityIndicator size="large" color="#886aea" /> : <FetalGrowthHistoryChart records={records} />}

        {/* Botão para a próxima tela */}
        <TouchableOpacity style={styles.button} onPress={handleNext}>
          <Text style={styles.buttonText}>Histórico de Exames (Tela 12)</Text>
        </TouchableOpacity>

      </ScrollView>
    </SafeAreaView>
  );
}


const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: '#E6E0F8', 
  },
  container: {
    flexGrow: 1,
    padding: 20,
    alignItems: 'center', 
  },
  button: {
    backgroundColor: '#886aea', 
    padding: 15,
    borderRadius: 25,
    alignItems: 'center',
    width: '100%', 
    marginTop: 30,
  },
  buttonText: {
    color: '#FFF',
    fontSize: 18,
    fontWeight: 'bold',
  },
});
