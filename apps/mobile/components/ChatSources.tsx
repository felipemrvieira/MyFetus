import React, { useState } from 'react';
import { Linking, StyleSheet, TouchableOpacity, View } from 'react-native';
import { FontAwesome } from '@expo/vector-icons';
import { AccessibleText as Text } from './AccessibleText';
import { ACCESSIBLE_COLORS } from '../theme/accessibility';
import type { ChatCitacao } from '../utils/chatApi';
import {
  canOpenSource,
  citationAccessibilityLabel,
  citationLocation,
  citationTitle,
  sourcesToggleLabel,
} from '../utils/chatCitations';

// "Fontes" expansível de uma resposta do chat (E4-04): documento, página/seção e trecho curto.
export default function ChatSources({ citations }: { citations: ChatCitacao[] }) {
  const [expanded, setExpanded] = useState(false);
  if (citations.length === 0) return null;

  return (
    <View style={styles.container}>
      <TouchableOpacity
        accessibilityRole="button"
        accessibilityLabel={sourcesToggleLabel(citations.length, expanded)}
        accessibilityState={{ expanded }}
        onPress={() => setExpanded((value) => !value)}
        style={styles.toggle}
        testID="chat-sources-toggle"
      >
        <FontAwesome name={expanded ? 'chevron-up' : 'book'} size={12} color={ACCESSIBLE_COLORS.primary} />
        <Text style={styles.toggleText}>{sourcesToggleLabel(citations.length, expanded)}</Text>
      </TouchableOpacity>

      {expanded && citations.map((citation) => {
        const location = citationLocation(citation);
        return (
          <View
            key={`${citation.numero}-${citation.documento_id ?? citation.titulo}`}
            style={styles.item}
            accessible
            accessibilityLabel={citationAccessibilityLabel(citation)}
          >
            <Text style={styles.title}>[{citation.numero}] {citationTitle(citation)}</Text>
            {!!location && <Text style={styles.location}>{location}</Text>}
            <Text style={styles.snippet}>“{citation.trecho}”</Text>
            {canOpenSource(citation) && (
              <TouchableOpacity
                accessibilityRole="link"
                accessibilityLabel={`Abrir o documento ${citation.titulo}`}
                onPress={() => Linking.openURL(citation.url as string)}
              >
                <Text style={styles.link}>Abrir documento oficial</Text>
              </TouchableOpacity>
            )}
          </View>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { marginTop: 8, borderTopWidth: 1, borderTopColor: '#eee', paddingTop: 6 },
  toggle: { flexDirection: 'row', alignItems: 'center', gap: 6, minHeight: 32, alignSelf: 'flex-start' },
  toggleText: { fontSize: 13, fontWeight: '600', color: ACCESSIBLE_COLORS.primary },
  item: { backgroundColor: '#F7F7FB', borderRadius: 10, padding: 8, marginTop: 6 },
  title: { fontSize: 13, fontWeight: '600', color: '#333' },
  location: { fontSize: 12, color: '#555', marginTop: 2 },
  snippet: { fontSize: 12, color: '#444', marginTop: 4, fontStyle: 'italic', lineHeight: 17 },
  link: { fontSize: 12, color: ACCESSIBLE_COLORS.primary, textDecorationLine: 'underline', marginTop: 6 },
});
