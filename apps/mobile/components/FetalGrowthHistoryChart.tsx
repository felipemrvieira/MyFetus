import React from 'react';
import { Dimensions, StyleSheet, Text, View } from 'react-native';
import {
  VictoryAxis,
  VictoryChart,
  VictoryLine,
  VictoryScatter,
} from 'victory-native';
import {
  FetalBiometryRecord,
  getFetalHistoryDomain,
} from '../utils/fetalHistory';

type Props = {
  records: FetalBiometryRecord[];
};

export default function FetalGrowthHistoryChart({ records }: Props) {
  const screenWidth = Dimensions.get('window').width;
  const chartWidth = Math.min(screenWidth - 40, 420);

  if (records.length === 0) {
    return (
      <View style={styles.container}>
        <Text style={styles.title}>Histórico de ultrassons</Text>
        <Text style={styles.emptyText}>
          Ainda não há biometria fetal registrada para esta gestação.
        </Text>
      </View>
    );
  }

  const domain = getFetalHistoryDomain(records);
  const estimated = records.map((record) => ({
    x: record.gestational_age_weeks,
    y: record.estimated_weight_grams,
  }));
  const median = records.map((record) => ({
    x: record.gestational_age_weeks,
    y: record.expected_median_weight_grams,
  }));

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Histórico de ultrassons</Text>
      <Text style={styles.subtitle}>
        PFE estimado pelo Hadlock por idade gestacional. O gráfico apoia a revisão profissional e não é diagnóstico.
      </Text>

      <VictoryChart
        width={chartWidth}
        height={310}
        domain={domain}
        padding={{ top: 15, bottom: 52, left: 62, right: 18 }}
      >
        <VictoryLine
          data={median}
          style={{ data: { stroke: '#6B7280', strokeWidth: 2, strokeDasharray: '6,4' } }}
        />
        <VictoryLine
          data={estimated}
          style={{ data: { stroke: '#886AEA', strokeWidth: 2 } }}
        />
        <VictoryScatter
          data={estimated}
          size={4}
          style={{ data: { fill: '#886AEA' } }}
        />
        <VictoryAxis
          tickValues={[10, 14, 18, 22, 26, 30, 34, 38, 42]}
          label="Semanas de gestação"
          style={{
            axisLabel: { padding: 32, fontSize: 12, fill: '#555' },
            tickLabels: { fontSize: 10, fill: '#555' },
          }}
        />
        <VictoryAxis
          dependentAxis
          label="Peso fetal estimado (g)"
          style={{
            axisLabel: { padding: 44, fontSize: 12, fill: '#555' },
            tickLabels: { fontSize: 10, fill: '#555' },
          }}
        />
      </VictoryChart>

      <View style={styles.legend} accessibilityRole="summary">
        <Legend color="#886AEA" label="PFE registrado" />
        <Legend color="#6B7280" label="Mediana Hadlock" dashed />
      </View>

      <View style={styles.table} accessibilityLabel="Tabela de medições de ultrassom">
        <View style={styles.tableRow}>
          <Text style={[styles.cell, styles.header]}>IG</Text>
          <Text style={[styles.cell, styles.header]}>Data</Text>
          <Text style={[styles.cell, styles.header]}>PFE</Text>
          <Text style={[styles.cell, styles.header]}>Pctl.</Text>
        </View>
        {records.map((record) => (
          <View style={styles.tableRow} key={record.id}>
            <Text style={styles.cell}>{record.gestational_age_weeks.toFixed(1)} sem</Text>
            <Text style={styles.cell}>{record.measured_at}</Text>
            <Text style={styles.cell}>{record.estimated_weight_grams} g</Text>
            <Text style={styles.cell}>{record.percentile.toFixed(1)}</Text>
          </View>
        ))}
      </View>
    </View>
  );
}

function Legend({ color, label, dashed = false }: { color: string; label: string; dashed?: boolean }) {
  return (
    <View style={styles.legendItem}>
      <View style={[styles.legendLine, { backgroundColor: color }, dashed && styles.dashed]} />
      <Text style={styles.legendText}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    width: '100%',
    backgroundColor: '#F8F6FF',
    borderRadius: 20,
    paddingVertical: 16,
    paddingHorizontal: 8,
    alignItems: 'center',
    marginBottom: 30,
  },
  title: { fontSize: 18, fontWeight: 'bold', color: '#333', textAlign: 'center' },
  subtitle: { color: '#555', fontSize: 13, lineHeight: 18, marginTop: 8, paddingHorizontal: 12, textAlign: 'center' },
  emptyText: { color: '#777', fontSize: 14, padding: 24, textAlign: 'center' },
  legend: { flexDirection: 'row', flexWrap: 'wrap', gap: 12, justifyContent: 'center', marginBottom: 12 },
  legendItem: { alignItems: 'center', flexDirection: 'row', marginHorizontal: 4 },
  legendLine: { height: 3, marginRight: 6, width: 20 },
  dashed: { borderStyle: 'dashed', borderWidth: 1, height: 0 },
  legendText: { color: '#555', fontSize: 12 },
  table: { borderColor: '#DDD6FE', borderRadius: 8, borderWidth: 1, width: '100%' },
  tableRow: { borderBottomColor: '#E5E7EB', borderBottomWidth: 1, flexDirection: 'row', paddingHorizontal: 8, paddingVertical: 8 },
  cell: { color: '#333', flex: 1, fontSize: 12, textAlign: 'center' },
  header: { fontWeight: '700' },
});
