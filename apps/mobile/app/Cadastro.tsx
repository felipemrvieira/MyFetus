import { View, Text, TextInput, TouchableOpacity, StyleSheet, Alert, Image, ActivityIndicator, Modal, ScrollView } from 'react-native';
import { useCallback, useEffect, useState } from 'react';
import { LinearGradient } from 'expo-linear-gradient';
import { useRouter } from 'expo-router';
import { api } from '../utils/apiClient';
import {
  buildSignupConsents,
  ConsentPolicy,
  getApiErrorInfo,
  parseConsentPolicy,
} from '../utils/consent';

export default function Cadastro() {
  const [nome, setNome] = useState('');
  const [email, setEmail] = useState('');
  const [dataNascimento, setDataNascimento] = useState('');
  const [senha, setSenha] = useState('');
  const [confirmarSenha, setConfirmarSenha] = useState('');
  const [loading, setLoading] = useState(false);
  const [errors, setErrors] = useState<{[key: string]: string}>({});
  const [policy, setPolicy] = useState<ConsentPolicy | null>(null);
  const [aceitouTermo, setAceitouTermo] = useState(false);
  const [mostrarTermo, setMostrarTermo] = useState(false);
  const router = useRouter();

  // E7-01.1: o termo vigente vem da API; sem ele não é possível cadastrar.
  const carregarTermo = useCallback(async () => {
    try {
      const response = await api.get('/consents/policy');
      setPolicy(parseConsentPolicy(response.data));
    } catch {
      setPolicy(null);
    }
  }, []);

  useEffect(() => {
    let ativo = true;
    api
      .get('/consents/policy')
      .then((response) => {
        if (ativo) setPolicy(parseConsentPolicy(response.data));
      })
      .catch(() => {
        if (ativo) setPolicy(null);
      });
    return () => {
      ativo = false;
    };
  }, []);

  const validarEmail = (email: string) => {
    const regex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    return regex.test(email);
  };

  const validarData = (data: string) => {
    const regex = /^(0[1-9]|[12][0-9]|3[01])\/(0[1-9]|1[0-2])\/\d{4}$/;
    if (!regex.test(data)) return false;

    const [dia, mes, ano] = data.split('/').map(Number);
    const dataObj = new Date(ano, mes - 1, dia);
    
    return dataObj.getDate() === dia &&
           dataObj.getMonth() === mes - 1 &&
           dataObj.getFullYear() === ano;
  };

  const validarSenha = (senha: string) => {
    return senha.length >= 8;
  };

  const validarFormulario = () => {
    const novosErros: {[key: string]: string} = {};

    if (!nome.trim()) {
      novosErros.nome = 'Nome é obrigatório';
    }

    if (!email.trim()) {
      novosErros.email = 'E-mail é obrigatório';
    } else if (!validarEmail(email)) {
      novosErros.email = 'E-mail inválido';
    }

    
    if (!dataNascimento) {
      novosErros.dataNascimento = 'Data de nascimento é obrigatória';
    } else if (!validarData(dataNascimento)) {
      novosErros.dataNascimento = 'Data inválida';
    }

    if (!senha) {
      novosErros.senha = 'Senha é obrigatória';
    } else if (!validarSenha(senha)) {
      novosErros.senha = 'A senha deve ter pelo menos 8 caracteres';
    }

    if (!confirmarSenha) {
      novosErros.confirmarSenha = 'Confirme sua senha';
    } else if (senha !== confirmarSenha) {
      novosErros.confirmarSenha = 'As senhas não coincidem';
    }

    if (!policy) {
      novosErros.termo = 'Não foi possível carregar o termo. Verifique sua conexão.';
    } else if (!aceitouTermo) {
      novosErros.termo = 'É preciso aceitar o termo de uso e a política de privacidade';
    }

    setErrors(novosErros);
    return Object.keys(novosErros).length === 0;
  };

  const formatarData = (text: string) => {
    const cleaned = text.replace(/\D/g, '');
    let formatted = '';

    if (cleaned.length <= 2) {
      formatted = cleaned;
    } else if (cleaned.length <= 4) {
      formatted = cleaned.slice(0, 2) + '/' + cleaned.slice(2);
    } else if (cleaned.length <= 8) {
      formatted = cleaned.slice(0, 2) + '/' + cleaned.slice(2, 4) + '/' + cleaned.slice(4);
    } else {
      formatted = cleaned.slice(0, 2) + '/' + cleaned.slice(2, 4) + '/' + cleaned.slice(4, 8);
    }

    return formatted;
  };

  const handleCadastro = async () => {
    if (!validarFormulario() || !policy) {
      return;
    }

    try {
      setLoading(true);

      const [dia, mes, ano] = dataNascimento.split('/');
      const dataFormatada = `${ano}-${mes}-${dia}`;

      const dadosCadastro = {
        name: nome,
        email: email,
        password: senha,
        birthdate: dataFormatada,
        consents: buildSignupConsents(policy),
      };

      await api.post('/users', dadosCadastro);

      Alert.alert(
        'Sucesso!',
        'Sua conta foi criada com sucesso! Você será redirecionado para a página de login.',
        [
          {
            text: 'OK',
            onPress: () => router.push('/login')
          }
        ]
      );
    } catch (error) {
      const apiError = getApiErrorInfo(error);
      let mensagemErro = 'Erro ao criar conta';

      if (apiError.code === 'CONSENT_VERSION_OUTDATED') {
        // O termo mudou enquanto a pessoa preenchia: recarrega e pede novo aceite.
        setAceitouTermo(false);
        await carregarTermo();
        mensagemErro = 'O termo de uso foi atualizado. Leia a nova versão e aceite novamente.';
      } else if (apiError.status === 409) {
        mensagemErro = 'Este e-mail já está cadastrado';
      } else if (apiError.message) {
        mensagemErro = apiError.message;
      } else if (apiError.status === null) {
        mensagemErro = 'Erro de conexão. Verifique sua internet';
      }

      Alert.alert('Erro', mensagemErro);
    } finally {
      setLoading(false);
    }
  };

  const handleVoltarLogin = () => {
    router.push('/login');
  };

  return (
    <LinearGradient
      colors={["#cce5f6", "#f8cde9"]}
      style={styles.container}
    >
      {/* Rolagem: com o termo de consentimento o formulário não cabe em telas pequenas. */}
      <ScrollView
        contentContainerStyle={styles.scrollContent}
        keyboardShouldPersistTaps="handled"
        style={styles.scroll}
      >
      <View style={styles.formBox}>
        <Image
          source={require("../assets/images/fetus-heart.png")}
          style={styles.heartImage}
          resizeMode="contain"
        />
        
        <Text style={styles.title}>Crie sua Conta</Text>
        
        <TextInput
          placeholder="Nome"
          value={nome}
          onChangeText={(text) => {
            setNome(text);
            setErrors(prev => ({...prev, nome: ''}));
          }}
          style={[styles.input, errors.nome && styles.inputError]}
          placeholderTextColor="#f9a9a7"
          editable={!loading}
        />
        {errors.nome && <Text style={styles.errorText}>{errors.nome}</Text>}

        <TextInput
          placeholder="E-mail"
          value={email}
          onChangeText={(text) => {
            setEmail(text);
            setErrors(prev => ({...prev, email: ''}));
          }}
          style={[styles.input, errors.email && styles.inputError]}
          keyboardType="email-address"
          autoCapitalize="none"
          placeholderTextColor="#f9a9a7"
          editable={!loading}
        />
        {errors.email && <Text style={styles.errorText}>{errors.email}</Text>}

        {/* Campo de Data de Nascimento agora é obrigatório para todos */}
        <TextInput
          placeholder="Data de Nascimento (DD/MM/AAAA)"
          value={dataNascimento}
          onChangeText={(text) => {
            setDataNascimento(formatarData(text));
            setErrors(prev => ({...prev, dataNascimento: ''}));
          }}
          style={[styles.input, errors.dataNascimento && styles.inputError]}
          keyboardType="numeric"
          maxLength={10}
          placeholderTextColor="#f9a9a7"
          editable={!loading}
        />
        {errors.dataNascimento && <Text style={styles.errorText}>{errors.dataNascimento}</Text>}

        <TextInput
          placeholder="Senha"
          value={senha}
          onChangeText={(text) => {
            setSenha(text);
            setErrors(prev => ({...prev, senha: ''}));
          }}
          secureTextEntry
          style={[styles.input, errors.senha && styles.inputError]}
          placeholderTextColor="#f9a9a7"
          editable={!loading}
        />
        {errors.senha && <Text style={styles.errorText}>{errors.senha}</Text>}

        <TextInput
          placeholder="Confirmar Senha"
          value={confirmarSenha}
          onChangeText={(text) => {
            setConfirmarSenha(text);
            setErrors(prev => ({...prev, confirmarSenha: ''}));
          }}
          secureTextEntry
          style={[styles.input, errors.confirmarSenha && styles.inputError]}
          placeholderTextColor="#f9a9a7"
          editable={!loading}
        />
        {errors.confirmarSenha && <Text style={styles.errorText}>{errors.confirmarSenha}</Text>}

        <View style={styles.termRow}>
          <TouchableOpacity
            accessibilityRole="checkbox"
            aria-checked={aceitouTermo}
            aria-disabled={!policy || loading}
            accessibilityLabel="Li e aceito o termo de uso e a política de privacidade"
            disabled={!policy || loading}
            onPress={() => {
              setAceitouTermo((value) => !value);
              setErrors(prev => ({...prev, termo: ''}));
            }}
            style={styles.checkboxTouch}
          >
            <View style={[styles.checkbox, aceitouTermo && styles.checkboxChecked]}>
              {aceitouTermo && <Text style={styles.checkboxMark}>✓</Text>}
            </View>
            <Text style={styles.termText}>
              Li e aceito o termo de uso e a política de privacidade
              {policy ? ` (versão ${buildSignupConsents(policy).map((item) => item.version).join(', ')})` : ''}
            </Text>
          </TouchableOpacity>
        </View>
        <TouchableOpacity
          accessibilityRole="button"
          accessibilityLabel="Ler o termo de uso e a política de privacidade"
          disabled={!policy}
          onPress={() => setMostrarTermo(true)}
          style={styles.readTermButton}
        >
          <Text style={styles.readTermText}>
            {policy ? 'Ler o termo' : 'Carregando o termo...'}
          </Text>
        </TouchableOpacity>
        {errors.termo ? <Text style={styles.errorText}>{errors.termo}</Text> : null}

        <TouchableOpacity
          style={[styles.loginButton, loading && styles.loginButtonDisabled]} 
          onPress={handleCadastro}
          disabled={loading}
        >
          {loading ? (
            <ActivityIndicator color="#fff" />
          ) : (
            <Text style={styles.loginText}>Cadastrar</Text>
          )}
        </TouchableOpacity>

        <TouchableOpacity onPress={handleVoltarLogin} disabled={loading}>
          <Text style={styles.createAccountText}>Voltar para Login</Text>
        </TouchableOpacity>
      </View>
      <View style={styles.footerContainer}>
        <Image
          source={require("../assets/images/poli-upe-logo.png")}
          style={styles.logo}
          resizeMode="contain"
        />
      </View>
      </ScrollView>

      <Modal
        visible={mostrarTermo}
        animationType="slide"
        transparent
        onRequestClose={() => setMostrarTermo(false)}
      >
        <View style={styles.modalBackdrop}>
          <View style={styles.modalCard}>
            {policy?.purposes.map((item) => (
              <View key={item.purpose} style={styles.modalSection}>
                <Text accessibilityRole="header" style={styles.modalTitle}>
                  {item.title}
                </Text>
                <Text style={styles.modalVersion}>Versão {item.version}</Text>
                <ScrollView style={styles.modalScroll}>
                  <Text style={styles.modalText}>{item.text}</Text>
                </ScrollView>
              </View>
            ))}
            <TouchableOpacity
              accessibilityRole="button"
              onPress={() => setMostrarTermo(false)}
              style={styles.modalCloseButton}
            >
              <Text style={styles.loginText}>Fechar</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    </LinearGradient>
  );
}

// Estilos
const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  scroll: {
    width: "100%",
  },
  scrollContent: {
    flexGrow: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 30,
    paddingTop: 70,
  },
  footerContainer: {
    width: "100%",
    height: 100,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 20
  },
  formBox: {
    backgroundColor: "rgba(255,255,255,0.3)",
    borderRadius: 20,
    padding: 20,
    width: "100%",
    alignItems: "center",
    borderWidth: 1,
    borderColor: "#fff",
    paddingVertical: 40
  },
  heartImage: {
    width: 120,
    height: 120,
    position: "absolute",
    top: -60,
    zIndex: 3,
  },
  title: {
    fontSize: 22,
    fontWeight: 'bold',
    color: '#555',
    marginBottom: 20,
    marginTop: 60,
  },
  input: {
    backgroundColor: "#fff",
    borderRadius: 25,
    paddingHorizontal: 15,
    paddingVertical: 10,
    width: "100%",
    marginBottom: 5,
    borderWidth: 1,
    borderColor: "#fff"
  },
  inputError: {
    borderColor: '#ff6b6b',
    borderWidth: 1,
  },
  errorText: {
    color: '#ff6b6b',
    fontSize: 12,
    marginBottom: 10,
    alignSelf: 'flex-start',
    marginLeft: 15,
  },
  loginButton: {
    backgroundColor: "#f9a9a7",
    paddingVertical: 12,
    borderRadius: 25,
    width: "100%",
    alignItems: "center",
    marginBottom: 10
  },
  loginButtonDisabled: {
    backgroundColor: "#f9a9a7aa",
  },
  loginText: {
    color: "#fff",
    fontWeight: "bold",
    fontSize: 16
  },
  createAccountText: {
    color: "#20B2AA",
    fontWeight: "bold",
    fontSize: 14
  },
  logo: {
    width: 240,
    height: 80
  },
  termRow: {
    width: "100%",
    marginTop: 5,
  },
  checkboxTouch: {
    alignItems: "center",
    flexDirection: "row",
    gap: 10,
    minHeight: 44,
  },
  checkbox: {
    alignItems: "center",
    backgroundColor: "#fff",
    borderColor: "#20B2AA",
    borderRadius: 6,
    borderWidth: 2,
    height: 24,
    justifyContent: "center",
    width: 24,
  },
  checkboxChecked: {
    backgroundColor: "#20B2AA",
  },
  checkboxMark: {
    color: "#fff",
    fontWeight: "bold",
  },
  termText: {
    color: "#444",
    flex: 1,
    fontSize: 13,
  },
  readTermButton: {
    alignSelf: "flex-start",
    justifyContent: "center",
    marginBottom: 10,
    marginLeft: 34,
    minHeight: 44,
  },
  readTermText: {
    color: "#20B2AA",
    fontWeight: "bold",
    textDecorationLine: "underline",
  },
  modalBackdrop: {
    alignItems: "center",
    backgroundColor: "rgba(0,0,0,0.4)",
    flex: 1,
    justifyContent: "center",
    padding: 20,
  },
  modalCard: {
    backgroundColor: "#fff",
    borderRadius: 16,
    maxHeight: "85%",
    maxWidth: 600,
    padding: 20,
    width: "100%",
  },
  modalSection: {
    flexShrink: 1,
  },
  modalTitle: {
    color: "#b34d7a",
    fontSize: 18,
    fontWeight: "bold",
  },
  modalVersion: {
    color: "#555",
    marginBottom: 10,
    marginTop: 2,
  },
  modalScroll: {
    flexGrow: 0,
  },
  modalText: {
    color: "#333",
    fontSize: 15,
    lineHeight: 22,
  },
  modalCloseButton: {
    alignItems: "center",
    backgroundColor: "#20B2AA",
    borderRadius: 25,
    marginTop: 16,
    paddingVertical: 12,
  },
});
