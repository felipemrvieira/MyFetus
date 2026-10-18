/**
 * Versão exibida ao usuário (tela Sobre, E7-09).
 *
 * Com `appVersionSource: "local"` no eas.json, a versão e o número de build
 * do artefato vêm do app.json no momento do build, e é essa configuração que
 * o `expo-constants` expõe em `Constants.expoConfig`.
 */
type VersionConfig = {
  version?: string;
  android?: { versionCode?: number };
  ios?: { buildNumber?: string };
} | null | undefined;

export type AppVersionInfo = {
  version: string;
  build: string | null;
  label: string;
};

const UNKNOWN_VERSION = 'não identificada';

export function getAppVersionInfo(config: VersionConfig, platform: string): AppVersionInfo {
  const version = config?.version?.trim() || UNKNOWN_VERSION;

  let build: string | null = null;
  if (platform === 'android' && config?.android?.versionCode !== undefined) {
    build = String(config.android.versionCode);
  } else if (platform === 'ios' && config?.ios?.buildNumber) {
    build = config.ios.buildNumber;
  }

  return {
    version,
    build,
    label: build ? `${version} (build ${build})` : version,
  };
}
