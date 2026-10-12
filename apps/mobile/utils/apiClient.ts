import axios from 'axios';
import AsyncStorage from '@react-native-async-storage/async-storage';

// 1 - Cria a base da API. Se não houver variável no .env, usa localhost.
export const api = axios.create({
  baseURL: process.env.EXPO_PUBLIC_API_URL || 'http://10.0.2.2:3000/api',
  timeout: 15000, 
});

// 2 - Intercetor de Pedidos: Injeta o Token JWT em todas as chamadas automaticamente
api.interceptors.request.use(
  async (config) => {
    try {
        const token = await AsyncStorage.getItem('authToken');
      if (token) {
        config.headers.Authorization = `Bearer ${token}`;
      }
    } catch (error) {
      console.error('Erro ao ler token', error);
    }
    return config;
  },
  (error) => Promise.reject(error)
);

// 3 -  Intercetor de Respostas: Lida com tokens expirados (opcional)
api.interceptors.response.use(
  (response) => response,
  async (error) => {
    if (error.response && error.response.status === 401) {
      // colocar a lógica para deslogar o utilizador aqui
      console.warn('Sessão expirada ou não autorizada');
    }
    return Promise.reject(error);
  }
);