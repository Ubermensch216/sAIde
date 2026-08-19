import { defineConfig } from 'wxt';
import tailwindcss from '@tailwindcss/vite';

// 계획서 §5 Phase 1-3. manifest 전체는 여기서 단일 관리한다.
export default defineConfig({
  srcDir: 'src',
  modules: ['@wxt-dev/module-react'],

  vite: () => ({
    plugins: [tailwindcss()],
  }),

  manifest: {
    name: 'sAIde — 옆에서 돕는 AI',
    short_name: 'sAIde',
    description: '내 컴퓨터에서만 도는 AI 브라우저 조력자. 인터넷 없이 작동합니다.',
    icons: {
      16: 'icon/16.png',
      32: 'icon/32.png',
      48: 'icon/48.png',
      128: 'icon/128.png',
    },

    action: {
      default_title: 'sAIde 열기',
    },

    permissions: [
      'sidePanel',
      'activeTab',
      'scripting',
      'storage',
      'contextMenus',
      'tabs',
    ],

    // 로컬 Ollama 외에는 어떤 호스트에도 접근하지 않는다.
    host_permissions: ['http://localhost:11434/*', 'http://127.0.0.1:11434/*'],

    commands: {
      _execute_action: {
        suggested_key: { default: 'Ctrl+Shift+S' },
        description: 'sAIde 사이드패널 열기',
      },
    },
  },
});
