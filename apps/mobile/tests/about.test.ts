import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import {
  ABOUT_DRAFT_NOTICE,
  ABOUT_IS_DRAFT,
  ABOUT_SECTIONS,
} from '../constants/aboutContent';
import { getAppVersionInfo } from '../utils/appVersion';

const root = join(__dirname, '..');
const appJson = JSON.parse(readFileSync(join(root, 'app.json'), 'utf8'));
const aboutScreenSource = readFileSync(join(root, 'app', 'sobre.tsx'), 'utf8');
const layoutSource = readFileSync(join(root, 'app', '_layout.tsx'), 'utf8');
const allText = [
  ABOUT_DRAFT_NOTICE,
  ...ABOUT_SECTIONS.flatMap((section) => [section.title, ...section.paragraphs]),
].join('\n');

describe('versão exibida na tela Sobre', () => {
  it('coincide com a versão e o build do app.json (artefato do EAS)', () => {
    const info = getAppVersionInfo(appJson.expo, 'android');
    assert.equal(info.version, appJson.expo.version);
    assert.equal(info.build, String(appJson.expo.android.versionCode));
    assert.equal(info.label, `${appJson.expo.version} (build ${appJson.expo.android.versionCode})`);
  });

  it('a tela lê a versão do artefato (Constants.expoConfig), sem valor fixo', () => {
    assert.match(aboutScreenSource, /getAppVersionInfo\(Constants\.expoConfig,/);
  });

  it('usa o buildNumber no iOS e omite build quando não há', () => {
    assert.equal(getAppVersionInfo({ version: '1.2.3', ios: { buildNumber: '7' } }, 'ios').label, '1.2.3 (build 7)');
    assert.equal(getAppVersionInfo({ version: '1.2.3' }, 'web').label, '1.2.3');
  });

  it('não quebra sem configuração', () => {
    assert.deepEqual(getAppVersionInfo(null, 'android'), {
      version: 'não identificada',
      build: null,
      label: 'não identificada',
    });
  });
});

describe('conteúdo da tela Sobre', () => {
  it('cobre projeto, aviso médico, limitações, equipe, contato e termos', () => {
    const ids = ABOUT_SECTIONS.map((section) => section.id);
    assert.deepEqual(ids, ['projeto', 'nao-substitui', 'limitacoes', 'equipe', 'contato', 'termos']);
    assert.match(allText, /acadêmico/);
    assert.match(allText, /não substituem consulta/);
    assert.match(allText, /urgência/);
    assert.match(allText, /dados sintéticos/);
  });

  it('fica marcado como rascunho enquanto o P.O. não aprova', () => {
    assert.equal(ABOUT_IS_DRAFT, true);
    assert.match(ABOUT_DRAFT_NOTICE, /aprovação/);
    assert.match(aboutScreenSource, /ABOUT_IS_DRAFT &&/);
  });

  it('não expõe ambiente interno, endereços ou segredos', () => {
    const forbidden = [
      /localhost/i,
      /\b\d{1,3}(\.\d{1,3}){3}\b/,
      /run\.app/i,
      /https?:\/\/(?!(www\.)?upe\.br)/i,
      /EXPO_PUBLIC_/,
      /JWT|token|secret|senha/i,
    ];
    for (const pattern of forbidden) {
      assert.doesNotMatch(allText, pattern);
    }
    for (const reference of ['process.env', 'apiClient', 'API_URL', 'projectId', 'extra']) {
      assert.equal(aboutScreenSource.includes(reference), false, `sobre.tsx não deve usar ${reference}`);
    }
  });

  it('não lista nomes de integrantes sem autorização', () => {
    const members = ['Felipe', 'Arthur', 'Bosco', 'Adryan', 'João', 'Lucas', 'Vinicius', 'Iually'];
    for (const name of members) {
      assert.equal(allText.includes(name), false, `nome não autorizado: ${name}`);
    }
  });
});

describe('navegação da tela Sobre', () => {
  it('a rota sobre fica fora dos Stack.Protected (disponível com e sem login)', () => {
    const outsideGuards = layoutSource.replace(/<Stack\.Protected[\s\S]*?<\/Stack\.Protected>/g, '');
    assert.match(outsideGuards, /<Stack\.Screen name="sobre"/);
  });

  it('a rota sobre é a última do Stack (não vira a tela inicial de quem está logado)', () => {
    // O expo-router envia rotas protegidas para a primeira tela disponível na ordem do Stack.
    const screens = [...layoutSource.matchAll(/<Stack\.Screen name="([^"]+)"/g)].map((match) => match[1]);
    assert.equal(screens.at(-1), 'sobre');
  });
});
