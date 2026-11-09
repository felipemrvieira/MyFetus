import React from 'react';
import { StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import { VictoryAxis, VictoryChart, VictoryLine, VictoryScatter } from 'victory-native';

type WeightMetric = { entry_date: string; weight_kg: number };
type BloodPressureMetric = { entry_date: string; systolic: number | null; diastolic: number | null };

type Props = {
  weight: WeightMetric[];
  bloodPressure: BloodPressureMetric[];
};

function toPoints(values: { entry_date: string; value: number }[]) {
  return values.map((item, index) => ({
    x: index + 1,
    y: item.value,
    label: item.entry_date,
  }));
}

export default function DailyMetricsChart({ weight, bloodPressure }: Props) {
  const { width } = useWindowDimensions();
  const chartWidth = Math.min(width - 40, 420);
  const weightPoints = toPoints(weight.map((item) => ({ entry_date: item.entry_date, value: item.weight_kg })));
  const systolicPoints = toPoints(bloodPressure
    .filter((item) => item.systolic !== null)
    .map((item) => ({ entry_date: item.entry_date, value: Number(item.systolic) })));
  const diastolicPoints = toPoints(bloodPressure
    .filter((item) => item.diastolic !== null)
    .map((item) => ({ entry_date: item.entry_date, value: Number(item.diastolic) })));

  return (
    <View style={styles.card} accessible={true} accessibilityLabel="Séries do diário de peso e pressão arterial">
      <Text style={styles.title}>Diário: peso e pressão arterial</Text>
      <Text style={styles.disclaimer}>
        Medições registradas no diário, exibidas por data. A interpretação clínica segue o motor de risco.
      </Text>
      <MetricSeries title="Peso (kg)" points={weightPoints} color="#886AEA" width={chartWidth} />
      <MetricSeries title="Pressão arterial (mmHg)" points={systolicPoints} secondary={diastolicPoints} color="#2F6FA3" width={chartWidth} />
    </View>
  );
}

function MetricSeries({
  title,
  points,
  secondary = [],
  color,
  width,
}: {
  title: string;
  points: { x: number; y: number; label: string }[];
  secondary?: { x: number; y: number; label: string }[];
  color: string;
  width: number;
}) {
  if (points.length === 0 && secondary.length === 0) {
    return <Text style={styles.empty}>{title}: nenhum registro disponível.</Text>;
  }
  const all = [...points, ...secondary];
  const min = Math.min(...all.map((point) => point.y));
  const max = Math.max(...all.map((point) => point.y));
  const padding = Math.max((max - min) * 0.2, 5);
  return (
    <View style={styles.series} accessible={true} accessibilityLabel={`Gráfico de ${title}`}>
      <Text style={styles.seriesTitle}>{title}</Text>
      <VictoryChart
        width={width}
        height={210}
        domain={{ x: [1, Math.max(all.length, 2)], y: [Math.max(0, min - padding), max + padding] }}
        padding={{ top: 15, bottom: 35, left: 50, right: 20 }}
      >
        {points.length > 1 && <VictoryLine data={points} style={{ data: { stroke: color, strokeWidth: 2 } }} />}
        <VictoryScatter data={points} size={4} style={{ data: { fill: color } }} />
        {secondary.length > 1 && <VictoryLine data={secondary} style={{ data: { stroke: '#D97706', strokeWidth: 2 } }} />}
        <VictoryScatter data={secondary} size={4} style={{ data: { fill: '#D97706' } }} />
        <VictoryAxis dependentAxis style={{ tickLabels: { fontSize: 10 } }} />
        <VictoryAxis tickFormat={(value) => String(value)} style={{ tickLabels: { fontSize: 9 } }} />
      </VictoryChart>
      {secondary.length > 0 && <Text style={styles.legend}>Sistólica • Diastólica</Text>}
    </View>
  );
}

const styles = StyleSheet.create({
  card: { width: '100%', backgroundColor: '#F8F6FF', borderRadius: 20, padding: 12, marginBottom: 24 },
  title: { fontSize: 18, fontWeight: 'bold', color: '#333', textAlign: 'center' },
  disclaimer: { marginTop: 8, color: '#555', fontSize: 12, textAlign: 'center' },
  series: { marginTop: 16 },
  seriesTitle: { fontSize: 15, fontWeight: '600', color: '#333', textAlign: 'center' },
  empty: { color: '#777', fontSize: 13, textAlign: 'center', paddingVertical: 18 },
  legend: { color: '#555', fontSize: 12, textAlign: 'center' },
});
