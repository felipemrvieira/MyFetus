import React, { useState, useEffect, useCallback } from 'react';
import {
  ActivityIndicator,
  Alert,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { api } from '../../../utils/apiClient';
import AnalyteSeriesChart from '../../../components/AnalyteSeriesChart';
import { AnalyteSeriesResponse } from '../../../utils/analyteChartData';

type AnalyteTab = 'hemoglobin' | 'fasting_glucose';

export default function SerieAnalitosScreen() {
  const router = useRouter();
  const { patientId } = useLocalSearchParams<{ patientId: string }>();

  const [selectedAnalyte, setSelectedAnalyte] = useState<AnalyteTab>('hemoglobin');
  const [loading, setLoading] = useState(true);
  const [seriesData, setSeriesData] = useState<AnalyteSeriesResponse | null>(null);

  const fetchSeries = useCallback((analyte: AnalyteTab) => {
    if (!patientId) return Promise.resolve();
    return api
      .get<AnalyteSeriesResponse>(`/lab-results/pregnant/${patientId}/series/${analyte}`)
      .then((response) => {
        setSeriesData(response.data);
      })
      .catch((err: unknown) => {
        const msg = err instanceof Error ? err.message : 'Erro ao carregar série do analito';
        Alert.alert('Erro', msg);
      })
      .finally(() => {
        setLoading(false);
      });
  }, [patientId]);

  useEffect(() => {
    fetchSeries(selectedAnalyte);
  }, [fetchSeries, selectedAnalyte]);

  const handleTabChange = (analyte: AnalyteTab) => {
    if (analyte === selectedAnalyte) return;
    setLoading(true);
    setSelectedAnalyte(analyte);
  };

  return (
    <SafeAreaView style={styles.safeArea}>
      <ScrollView contentContainerStyle={styles.container}>
        {/* Seletor de Analitos */}
        <View style={styles.selectorContainer} accessible={true} accessibilityRole="radiogroup">
          <TouchableOpacity
            style={[styles.tabButton, selectedAnalyte === 'hemoglobin' && styles.tabButtonActive]}
            onPress={() => handleTabChange('hemoglobin')}
            accessibilityRole="radio"
            accessibilityState={{ selected: selectedAnalyte === 'hemoglobin' }}
            accessibilityLabel="Selecionar Hemoglobina"
          >
            <Text
              style={[styles.tabButtonText, selectedAnalyte === 'hemoglobin' && styles.tabButtonTextActive]}
            >
              Hemoglobina
            </Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[styles.tabButton, selectedAnalyte === 'fasting_glucose' && styles.tabButtonActive]}
            onPress={() => handleTabChange('fasting_glucose')}
            accessibilityRole="radio"
            accessibilityState={{ selected: selectedAnalyte === 'fasting_glucose' }}
            accessibilityLabel="Selecionar Glicemia de Jejum"
          >
            <Text
              style={[styles.tabButtonText, selectedAnalyte === 'fasting_glucose' && styles.tabButtonTextActive]}
            >
              Glicemia de Jejum
            </Text>
          </TouchableOpacity>
        </View>

        {loading ? (
          <View style={styles.loadingContainer}>
            <ActivityIndicator size="large" color="#886aea" />
            <Text style={styles.loadingText}>Carregando evolução do analito...</Text>
          </View>
        ) : seriesData ? (
          <AnalyteSeriesChart series={seriesData} />
        ) : null}

        {/* Botão de retorno ao histórico */}
        <TouchableOpacity
          style={styles.backButton}
          onPress={() => router.push(`/doctor/${patientId}/historico_exames`)}
          accessibilityRole="button"
          accessibilityLabel="Voltar para histórico de exames"
        >
          <Text style={styles.backButtonText}>Voltar para Exames</Text>
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
    padding: 16,
    alignItems: 'center',
  },
  selectorContainer: {
    flexDirection: 'row',
    backgroundColor: '#D1C4E9',
    borderRadius: 24,
    padding: 4,
    marginBottom: 16,
    width: '100%',
    maxWidth: 420,
  },
  tabButton: {
    flex: 1,
    paddingVertical: 10,
    borderRadius: 20,
    alignItems: 'center',
  },
  tabButtonActive: {
    backgroundColor: '#5B3FB8',
  },
  tabButtonText: {
    fontSize: 14,
    fontWeight: '600',
    color: '#3F2C78',
  },
  tabButtonTextActive: {
    color: '#FFFFFF',
  },
  loadingContainer: {
    paddingVertical: 50,
    alignItems: 'center',
  },
  loadingText: {
    marginTop: 12,
    fontSize: 14,
    color: '#5B3FB8',
  },
  backButton: {
    backgroundColor: '#886aea',
    paddingVertical: 14,
    paddingHorizontal: 20,
    borderRadius: 25,
    alignItems: 'center',
    width: '100%',
    maxWidth: 420,
    marginTop: 10,
  },
  backButtonText: {
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: 'bold',
  },
});
