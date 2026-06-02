import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  // Forza Vite ad usare percorsi assoluti dalla root, fondamentale per i domini personalizzati
  base: '/', 
});