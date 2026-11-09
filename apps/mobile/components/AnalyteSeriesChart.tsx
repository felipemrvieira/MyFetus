import React from 'react';
import { StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import {
  VictoryAxis,
  VictoryChart,
  VictoryLine,
  VictoryScatter,
} from 'victory-native';
import {
  AnalyteSeriesResponse,
  calculateYDomain,
  formatChartData,
  getTrendBadgeInfo,
} from '../utils/analyteChartData';

type Props = {
  series: AnalyteSeriesResponse;
};

export default function AnalyteSeriesChart({ series }: Props) {
  const { width: windowWidth } = useWindowDimensions();
  const chartWidth = Math.min(windowWidth - 40, 420);

  const { points, analyte, trend, unit_conflict, accessibility_rows, disclaimer } = series;
  const badge = getTrendBadgeInfo(trend.direction);

  if (points.length === 0 && accessibility_rows.length === 0) {
    return (
      <View style={styles.card} accessible={true} accessibilityLabel="Estado sem dados para este analito">
        <Text style={styles.title}>{analyte.name}</Text>
        <Text style={styles.emptyTitle}>Nenhum resultado aceito ainda</Text>
        <Text style={styles.emptySubtitle}>
          Apenas resultados aceitos ou corrigidos pelo médico vinculado alimentam o gráfico de acompanhamento.
        </Text>
        <Text style={styles.disclaimerText}>{disclaimer}</Text>
      </View>
    );
  }

  const { data, usesGestationalWeeks } = formatChartData(points);
  const [minY, maxY] = calculateYDomain(points, analyte.threshold.value);

  const minX = data[0]?.x ?? 0;
  const maxX = data[data.length - 1]?.x ?? 1;
  const thresholdLineData = [
    { x: minX, y: analyte.threshold.value },
    { x: maxX === minX ? minX + 1 : maxX, y: analyte.threshold.value },
  ];

  return (
    <View style={styles.card}>
      <View style={styles.headerRow}>
        <View style={{ flex: 1 }}>
          <Text style={styles.title}>{analyte.name}</Text>
          <Text style={styles.thresholdSubtitle}>
            {analyte.threshold.label} ({analyte.threshold.value} {analyte.threshold.unit})
          </Text>
        </View>
        <View style={[styles.badge, { backgroundColor: badge.backgroundColor }]}>
          <Text style={[styles.badgeText, { color: badge.textColor }]}>{badge.label}</Text>
        </View>
      </View>

      <Text style={styles.trendMessage}>{trend.message}</Text>

      {unit_conflict && (
        <View style={styles.conflictAlert} accessible={true} accessibilityRole="alert">
          <Text style={styles.conflictAlertTitle}>Unidades divergentes detectadas</Text>
          <Text style={styles.conflictAlertText}>
            Exames com unidades não compatíveis foram segregados desta curva para evitar distorções clínicas.
            Consulte a tabela abaixo para ver todos os registros.
          </Text>
        </View>
      )}

      {/* Gráfico Victory */}
      {points.length > 0 ? (
        <>
          <View style={styles.chartWrapper} accessible={true} accessibilityLabel={`Gráfico da série de ${analyte.name}`}>
            <VictoryChart
              width={chartWidth}
              height={280}
              domain={{ y: [minY, maxY] }}
              padding={{ top: 20, bottom: 50, left: 55, right: 25 }}
            >
              {/* Linha normativa de corte clínico (contínua) */}
              <VictoryLine
                data={thresholdLineData}
                style={{
                  data: {
                    stroke: '#D92D20',
                    strokeWidth: 2,
                  },
                }}
              />

              {/* Linha conectando os pontos */}
              {data.length > 1 && (
                <VictoryLine
                  data={data}
                  style={{
                    data: {
                      stroke: '#886aea',
                      strokeWidth: 2.5,
                    },
                  }}
                />
              )}

              {/* Pontos dispersos */}
              <VictoryScatter
                data={data}
                size={5}
                style={{
                  data: {
                    fill: ({ datum }) => (datum.point.is_out_of_threshold ? '#D92D20' : '#886aea'),
                    stroke: '#fff',
                    strokeWidth: 1.5,
                  },
                }}
              />

              <VictoryAxis
                dependentAxis
                tickFormat={(t) => `${t}`}
                style={{
                  axis: { stroke: '#CBD5E1' },
                  tickLabels: { fontSize: 11, fill: '#475569' },
                  grid: { stroke: '#F1F5F9' },
                }}
              />

              <VictoryAxis
                tickFormat={(t) => (usesGestationalWeeks ? `${t}s` : `${t}`)}
                label={usesGestationalWeeks ? 'Idade Gestacional (semanas)' : 'Exame sequencial'}
                style={{
                  axis: { stroke: '#CBD5E1' },
                  axisLabel: { fontSize: 11, padding: 30, fill: '#64748B' },
                  tickLabels: { fontSize: 11, fill: '#475569' },
                }}
              />
            </VictoryChart>
          </View>

          {/* Legenda visual */}
          <View style={styles.legendContainer}>
            <View style={styles.legendItem}>
              <View style={[styles.legendIndicator, { backgroundColor: '#886aea' }]} />
              <Text style={styles.legendLabel}>Valor medido</Text>
            </View>
            <View style={styles.legendItem}>
              <View style={[styles.legendIndicator, { backgroundColor: '#D92D20' }]} />
              <Text style={styles.legendLabel}>Fora do limite</Text>
            </View>
            <View style={styles.legendItem}>
              <View style={[styles.legendIndicatorLine, { borderColor: '#D92D20' }]} />
              <Text style={styles.legendLabel}>Limite ({analyte.threshold.value} {analyte.threshold.unit})</Text>
            </View>
          </View>
        </>
      ) : (
        <View style={styles.emptyUnitNotice}>
          <Text style={styles.emptyUnitNoticeText}>
            Não há resultados na unidade padrão ({analyte.unit}) para compor a curva visual.
            Os registros encontrados constam na tabela detalhada abaixo.
          </Text>
        </View>
      )}

      {/* Tabela Alternativa de Acessibilidade */}
      <View style={styles.tableCard} accessible={true} accessibilityRole="list">
        <Text style={styles.tableTitle}>Valores detalhados (Acessibilidade)</Text>
        {accessibility_rows.map((row) => (
          <View
            key={row.id}
            style={[styles.tableRow, row.unit_conflict && styles.tableRowConflict]}
            accessible={true}
            accessibilityLabel={`${row.date}, ${row.gestational_age}, ${row.value_label}. ${row.status_description}. Referência: ${row.reference_range}`}
          >
            <View style={styles.tableColMain}>
              <Text style={styles.tableDate}>{row.date} • {row.gestational_age}</Text>
              <Text style={styles.tableValue}>{row.value_label}</Text>
              <Text style={styles.tableStatus}>{row.status_description}</Text>
            </View>
            <View style={styles.tableColRef}>
              <Text style={styles.tableRefLabel}>Ref. Lab</Text>
              <Text style={styles.tableRefValue}>{row.reference_range}</Text>
            </View>
          </View>
        ))}
      </View>

      {/* Disclaimer legal obrigatório */}
      <View style={styles.disclaimerContainer} accessible={true}>
        <Text style={styles.disclaimerText}>{disclaimer}</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    padding: 16,
    marginBottom: 20,
    elevation: 2,
    shadowColor: '#000',
    shadowOpacity: 0.05,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 2 },
    width: '100%',
  },
  headerRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: 8,
  },
  title: {
    fontSize: 18,
    fontWeight: '700',
    color: '#1E293B',
  },
  thresholdSubtitle: {
    fontSize: 13,
    color: '#64748B',
    marginTop: 2,
  },
  badge: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 12,
  },
  badgeText: {
    fontSize: 12,
    fontWeight: '600',
  },
  trendMessage: {
    fontSize: 13,
    color: '#475569',
    marginBottom: 12,
  },
  conflictAlert: {
    backgroundColor: '#FFFBEB',
    borderColor: '#FDE68A',
    borderWidth: 1,
    borderRadius: 8,
    padding: 10,
    marginBottom: 12,
  },
  conflictAlertTitle: {
    fontSize: 13,
    fontWeight: '700',
    color: '#92400E',
    marginBottom: 2,
  },
  conflictAlertText: {
    fontSize: 12,
    color: '#78350F',
    lineHeight: 16,
  },
  chartWrapper: {
    alignItems: 'center',
    marginVertical: 4,
  },
  legendContainer: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: 16,
    marginVertical: 10,
    flexWrap: 'wrap',
  },
  legendItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  legendIndicator: {
    width: 10,
    height: 10,
    borderRadius: 5,
  },
  legendIndicatorLine: {
    width: 14,
    height: 0,
    borderTopWidth: 2,
    borderStyle: 'dashed',
  },
  legendLabel: {
    fontSize: 11,
    color: '#64748B',
  },
  tableCard: {
    marginTop: 16,
    borderTopWidth: 1,
    borderTopColor: '#F1F5F9',
    paddingTop: 12,
  },
  tableTitle: {
    fontSize: 14,
    fontWeight: '700',
    color: '#334155',
    marginBottom: 8,
  },
  tableRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: '#F8FAFC',
  },
  tableRowConflict: {
    backgroundColor: '#FFFBEB',
    paddingHorizontal: 8,
    borderRadius: 6,
  },
  tableColMain: {
    flex: 1,
    paddingRight: 8,
  },
  tableDate: {
    fontSize: 11,
    color: '#64748B',
  },
  tableValue: {
    fontSize: 14,
    fontWeight: '700',
    color: '#1E293B',
    marginTop: 2,
  },
  tableStatus: {
    fontSize: 12,
    color: '#475569',
    marginTop: 2,
  },
  tableColRef: {
    alignItems: 'flex-end',
    justifyContent: 'center',
  },
  tableRefLabel: {
    fontSize: 10,
    color: '#94A3B8',
    textTransform: 'uppercase',
  },
  tableRefValue: {
    fontSize: 12,
    color: '#475569',
    marginTop: 2,
  },
  emptyUnitNotice: {
    backgroundColor: '#F8FAFC',
    borderRadius: 8,
    padding: 12,
    marginVertical: 12,
    borderWidth: 1,
    borderColor: '#E2E8F0',
  },
  emptyUnitNoticeText: {
    fontSize: 13,
    color: '#64748B',
    lineHeight: 18,
    textAlign: 'center',
  },
  emptyTitle: {
    fontSize: 15,
    fontWeight: '600',
    color: '#334155',
    marginTop: 10,
  },
  emptySubtitle: {
    fontSize: 13,
    color: '#64748B',
    marginTop: 4,
    lineHeight: 18,
  },
  disclaimerContainer: {
    marginTop: 16,
    paddingTop: 10,
    borderTopWidth: 1,
    borderTopColor: '#F1F5F9',
  },
  disclaimerText: {
    fontSize: 11,
    color: '#94A3B8',
    fontStyle: 'italic',
    textAlign: 'center',
  },
});
