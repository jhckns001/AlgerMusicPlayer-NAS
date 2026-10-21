<template>
  <responsive-modal
    v-model="visible"
    :title="t('settings.playback.musicSources')"
    @close="handleCancel"
  >
    <div class="flex flex-col h-full">
      <div v-if="isNasMode" class="mb-3 space-y-2 text-sm">
        <p :class="nasConnected ? 'text-emerald-600' : 'text-gray-500'">
          {{ nasConnected ? '已连接，音源配置保存在本实例中' : '连接播放器服务后可导入和同步音源' }}
        </p>
        <div v-if="nasAuthRequired" class="flex gap-2 min-w-0">
          <input v-model="nasKey" type="password" autocomplete="current-password"
            aria-label="播放器访问密钥" placeholder="本实例的访问密钥"
            class="min-w-0 flex-1 rounded-lg border border-gray-200 dark:border-white/10 bg-transparent px-3 py-2"
            @keyup.enter="handleNasConnect" />
          <button class="shrink-0 rounded-lg bg-emerald-500 px-3 py-2 text-white disabled:opacity-50"
            :disabled="nasConnecting" @click="handleNasConnect">
            {{ nasConnecting ? '连接中…' : '连接播放器服务' }}
          </button>
        </div>
        <p v-if="nasSyncError" role="alert" class="text-red-500">{{ nasSyncError }}</p>
      </div>
      <!-- Tabs Header -->
      <div class="flex p-0.5 mb-3 bg-gray-100 dark:bg-white/5 rounded-lg shrink-0">
        <button
          v-for="tab in tabs"
          :key="tab.key"
          class="flex-1 py-1 text-xs font-medium rounded-md transition-all duration-200"
          :class="[
            activeTab === tab.key
              ? 'bg-white dark:bg-white/10 text-gray-900 dark:text-white shadow-sm'
              : 'text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200'
          ]"
          @click="activeTab = tab.key"
        >
          {{ tab.label }}
        </button>
      </div>

      <!-- Tab Content -->
      <div class="h-[400px] relative shrink-0">
        <Transition name="fade" mode="out-in">
          <div :key="activeTab" class="h-full overflow-y-auto overscroll-contain">
            <!-- Sources Tab -->
            <div v-if="activeTab === 'sources'" class="space-y-3 pb-2">
              <p class="text-xs text-gray-500 dark:text-gray-400 px-1">
                {{ t('settings.playback.musicSourcesDesc') }}
              </p>

              <div class="grid grid-cols-2 md:grid-cols-3 gap-2">
                <div
                  v-for="source in allSources"
                  :key="source.key"
                  class="group relative flex items-center p-2.5 rounded-xl border transition-all duration-200 cursor-pointer"
                  :class="[
                    isSourceSelected(source.key)
                      ? 'bg-emerald-50/50 dark:bg-emerald-500/10 border-emerald-200 dark:border-emerald-500/20'
                      : 'bg-white dark:bg-white/5 border-gray-100 dark:border-white/5 hover:bg-gray-50 dark:hover:bg-white/10',
                    { 'opacity-60 cursor-not-allowed': !source.available }
                  ]"
                  @click="toggleSource(source.key)"
                >
                  <div
                    class="flex items-center justify-center w-8 h-8 rounded-full mr-2.5 transition-colors shrink-0"
                    :style="{
                      backgroundColor: isSourceSelected(source.key) ? source.color : 'transparent',
                      color: isSourceSelected(source.key) ? '#fff' : source.color
                    }"
                    :class="{ 'bg-gray-100 dark:bg-white/10': !isSourceSelected(source.key) }"
                  >
                    <i :class="source.icon" class="text-base"></i>
                  </div>

                  <div class="flex-1 min-w-0">
                    <div class="flex items-center justify-between">
                      <span class="font-semibold text-gray-900 dark:text-white text-sm truncate">{{
                        source.key
                      }}</span>
                      <div
                        class="w-4 h-4 rounded-full border flex items-center justify-center transition-colors shrink-0 ml-1"
                        :class="[
                          isSourceSelected(source.key)
                            ? 'bg-emerald-500 border-emerald-500'
                            : 'border-gray-300 dark:border-gray-600'
                        ]"
                      >
                        <i
                          v-if="isSourceSelected(source.key)"
                          class="ri-check-line text-white text-xs scale-75"
                        ></i>
                      </div>
                    </div>
                    <!-- lxMusic 子描述 -->
                    <p
                      v-if="source.key === 'lxMusic'"
                      class="text-[10px] text-gray-500 mt-0.5 truncate"
                    >
                      {{
                        activeLxApiId && lxMusicScriptInfo
                          ? lxMusicScriptInfo.name
                          : t('settings.playback.lxMusic.scripts.notConfigured')
                      }}
                    </p>
                    <!-- custom 子描述 -->
                    <p
                      v-else-if="source.key === 'custom'"
                      class="text-[10px] text-gray-500 mt-0.5 truncate"
                    >
                      {{
                        settingsStore.setData.customApiPlugin
                          ? t('settings.playback.customApi.status.imported')
                          : t('settings.playback.customApi.status.notImported')
                      }}
                    </p>
                  </div>
                </div>
              </div>
            </div>

            <!-- LX Music Management Tab -->
            <div v-else-if="activeTab === 'lxMusic'" class="space-y-3 pb-2">
              <div v-if="isNasMode" class="rounded-xl bg-gray-50 dark:bg-white/5 p-3 space-y-2">
                <div class="flex items-center justify-between gap-3">
                  <span class="text-sm font-medium">自动切换音源</span>
                  <n-switch :value="lxAutoSwitch" size="small" aria-label="自动切换音源"
                    @update:value="setLxAutoSwitch" />
                </div>
                <p class="text-xs text-gray-500 dark:text-gray-400 leading-relaxed">
                  {{ lxAutoSwitch ? '勾选参与切换的音源，用上下箭头调整优先级。先按顺序尝试设置的音质（默认 FLAC），全部失败再逐级降低。' : '只使用选中的音源，不可用时自动降低音质。' }}
                  设置自动保存；单次尝试最多 12 秒，每首歌总等待最多 45 秒。
                </p>
                <p v-if="nasLastLxResolution" class="text-xs text-emerald-600 dark:text-emerald-400 break-words">
                  最近解析：{{ nasLastLxResolution.song }} · {{ nasLastLxResolution.source }} · 请求音质 {{ nasLastLxResolution.quality.toUpperCase() }}
                </p>
              </div>
              <div class="flex justify-between items-center mb-1">
                <h3 class="text-xs font-medium text-gray-500 dark:text-gray-400">
                  {{ t('settings.playback.lxMusic.scripts.title') }}
                </h3>
                <button
                  @click="importLxMusicScript"
                  class="flex items-center gap-1 px-2.5 py-1 bg-emerald-500 hover:bg-emerald-600 text-white text-xs font-medium rounded-lg transition-colors"
                >
                  <i class="ri-upload-line"></i>
                  {{ t('settings.playback.lxMusic.scripts.importLocal') }}
                </button>
              </div>

              <!-- Script List -->
              <div v-if="lxMusicApis.length > 0" class="grid grid-cols-1 gap-2" :class="{ 'md:grid-cols-3': !isNasMode }">
                <div
                  v-for="(api, apiIndex) in lxMusicApis"
                  :key="api.id"
                  class="flex items-center p-2.5 rounded-xl border transition-all duration-200"
                  :class="[
                    isLxSelected(api)
                      ? 'bg-emerald-50/50 dark:bg-emerald-500/10 border-emerald-200 dark:border-emerald-500/20'
                      : 'bg-white dark:bg-white/5 border-gray-100 dark:border-white/5'
                  ]"
                >
                  <div class="relative flex items-center justify-center w-4 h-4 mr-3">
                    <input
                      :type="isNasMode && lxAutoSwitch ? 'checkbox' : 'radio'"
                      :aria-label="`${isNasMode && lxAutoSwitch ? '启用音源' : '选择音源'} ${api.name}`"
                      :checked="isLxSelected(api)"
                      class="peer appearance-none w-4 h-4 rounded-full border border-gray-300 dark:border-gray-600 checked:border-emerald-500 checked:bg-emerald-500 transition-colors cursor-pointer"
                      @change="isNasMode && lxAutoSwitch ? toggleLxEnabled(api.id) : setActiveLxApi(api.id)"
                    />
                    <i
                      class="ri-check-line absolute text-white text-[10px] pointer-events-none opacity-0 peer-checked:opacity-100 transition-opacity"
                    ></i>
                  </div>

                  <div class="flex-1 min-w-0 mr-2">
                    <div class="flex items-center gap-2">
                      <span
                        v-if="editingScriptId !== api.id"
                        class="font-medium text-sm text-gray-900 dark:text-white truncate"
                      >
                        {{ api.name }}
                      </span>
                      <input
                        v-else
                        v-model="editingName"
                        ref="renameInputRef"
                        class="w-full px-2 py-0.5 text-sm bg-white dark:bg-black/20 border border-emerald-500 rounded focus:outline-none"
                        @blur="saveScriptName(api.id)"
                        @keyup.enter="saveScriptName(api.id)"
                      />

                      <button
                        v-if="editingScriptId !== api.id"
                        class="text-gray-400 hover:text-emerald-500 transition-colors"
                        @click="startRenaming(api)"
                      >
                        <i class="ri-edit-line text-sm"></i>
                      </button>
                    </div>
                    <div class="flex items-center gap-2 mt-0.5">
                      <span v-if="isNasMode" class="text-[10px] text-gray-500">
                        优先级 {{ apiIndex + 1 }}{{ activeLxApiId === api.id ? ' · 首选' : '' }}
                      </span>
                      <span
                        v-if="api.info.version"
                        class="text-[10px] text-gray-500 bg-gray-100 dark:bg-white/10 px-1.5 py-0.5 rounded"
                      >
                        v{{ api.info.version }}
                      </span>
                    </div>
                  </div>

                  <div v-if="isNasMode" class="flex shrink-0">
                    <button class="w-8 h-8 rounded-lg text-gray-500 hover:bg-gray-100 dark:hover:bg-white/10 disabled:opacity-25"
                      :aria-label="`提高 ${api.name} 优先级`" :disabled="apiIndex === 0"
                      @click="moveLxApi(api.id, -1)"><i class="ri-arrow-up-line" /></button>
                    <button class="w-8 h-8 rounded-lg text-gray-500 hover:bg-gray-100 dark:hover:bg-white/10 disabled:opacity-25"
                      :aria-label="`降低 ${api.name} 优先级`" :disabled="apiIndex === lxMusicApis.length - 1"
                      @click="moveLxApi(api.id, 1)"><i class="ri-arrow-down-line" /></button>
                  </div>
                  <button
                    class="p-1.5 text-gray-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-500/10 rounded-lg transition-colors"
                    :aria-label="`删除音源 ${api.name}`"
                    @click="removeLxApi(api.id)"
                  >
                    <i class="ri-delete-bin-line text-sm"></i>
                  </button>
                </div>
              </div>

              <div
                v-else
                class="py-6 text-center text-xs text-gray-400 bg-gray-50 dark:bg-white/5 rounded-xl border border-dashed border-gray-200 dark:border-white/10"
              >
                <p>{{ t('settings.playback.lxMusic.scripts.empty') }}</p>
              </div>

              <!-- URL Import -->
              <div class="mt-4 pt-4 border-t border-gray-100 dark:border-white/5">
                <h4 class="text-xs font-medium mb-2 text-gray-900 dark:text-white">
                  {{ t('settings.playback.lxMusic.scripts.importOnline') }}
                </h4>
                <div class="flex gap-2">
                  <input
                    v-model="lxScriptUrl"
                    :placeholder="t('settings.playback.lxMusic.scripts.urlPlaceholder')"
                    class="flex-1 px-3 py-1.5 bg-gray-50 dark:bg-white/5 border border-gray-200 dark:border-white/10 rounded-xl text-xs focus:outline-none focus:border-emerald-500 transition-colors"
                    :disabled="isImportingFromUrl"
                  />
                  <button
                    @click="importLxMusicScriptFromUrl"
                    class="px-3 py-1.5 bg-emerald-500 hover:bg-emerald-600 disabled:opacity-50 disabled:cursor-not-allowed text-white text-xs font-medium rounded-xl transition-colors flex items-center gap-1"
                    :disabled="!lxScriptUrl.trim() || isImportingFromUrl"
                  >
                    <i v-if="isImportingFromUrl" class="ri-loader-4-line animate-spin"></i>
                    <i v-else class="ri-download-line"></i>
                    {{ t('settings.playback.lxMusic.scripts.importBtn') }}
                  </button>
                </div>
              </div>
            </div>

            <!-- Custom API Tab -->
            <div
              v-else-if="activeTab === 'customApi'"
              class="flex flex-col items-center justify-center py-6 text-center h-full"
            >
              <div
                class="w-12 h-12 bg-violet-100 dark:bg-violet-500/20 text-violet-500 rounded-xl flex items-center justify-center mb-3"
              >
                <i class="ri-plug-fill text-2xl"></i>
              </div>

              <h3 class="text-base font-semibold text-gray-900 dark:text-white mb-1">
                {{ t('settings.playback.customApi.sectionTitle') }}
              </h3>
              <p class="text-gray-500 dark:text-gray-400 text-xs mb-4 max-w-xs mx-auto">
                {{ t('settings.playback.lxMusic.scripts.importHint') }}
              </p>

              <button
                @click="importPlugin"
                class="px-5 py-2 bg-violet-500 hover:bg-violet-600 text-white text-sm font-medium rounded-xl transition-colors flex items-center gap-2 shadow-lg shadow-violet-500/20"
              >
                <i class="ri-upload-line"></i>
                {{ t('settings.playback.customApi.importConfig') }}
              </button>

              <div
                v-if="settingsStore.setData.customApiPluginName"
                class="mt-4 flex items-center gap-2 px-3 py-1.5 bg-green-50 dark:bg-green-500/10 text-green-600 dark:text-green-400 rounded-lg text-xs"
              >
                <i class="ri-check-circle-fill"></i>
                <span
                  >{{ t('settings.playback.customApi.currentSource') }}:
                  <b>{{ settingsStore.setData.customApiPluginName }}</b></span
                >
              </div>

              <div v-else class="mt-4 text-xs text-gray-400">
                {{ t('settings.playback.customApi.notImported') }}
              </div>
            </div>
          </div>
        </Transition>
      </div>
    </div>

    <!-- Footer Actions -->
    <template #footer>
      <div class="flex justify-end gap-2">
        <button
          class="px-4 py-2 text-xs font-medium text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-white/10 rounded-lg transition-colors"
          @click="handleCancel"
        >
          {{ t('common.cancel') }}
        </button>
        <button
          class="px-4 py-2 text-xs font-medium text-white bg-emerald-500 hover:bg-emerald-600 rounded-lg shadow-lg shadow-emerald-500/20 transition-all active:scale-95"
          @click="handleConfirm"
        >
          {{ t('common.confirm') }}
        </button>
      </div>
    </template>
  </responsive-modal>
</template>

<script setup lang="ts">
import { useMessage } from 'naive-ui';
import { computed, nextTick, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';

import ResponsiveModal from '@/components/common/ResponsiveModal.vue';
import { connectNas, importNasScript, isNasMode, nasConnected, nasAuthRequired, nasSyncError, nasHttpRequest, refreshNasConnection, nasLastLxResolution } from '@/services/nasClient';
import { orderedLxScripts } from '@/services/lxFailover';
import {
  initLxMusicRunner,
  parseScriptInfo,
  setLxMusicRunner
} from '@/services/LxMusicSourceRunner';
import { useSettingsStore } from '@/store';
import type { LxMusicScriptConfig, LxScriptInfo, LxSourceKey } from '@/types/lxMusic';
import { type Platform } from '@/types/music';
import { useMusicSources } from '@/utils/musicSourceConfig';

// ==================== Props & Emits ====================
const props = defineProps({
  show: {
    type: Boolean,
    default: false
  },
  sources: {
    type: Array as () => Platform[],
    default: () => ['migu', 'kugou', 'kuwo', 'pyncmd'] as Platform[]
  }
});

const emit = defineEmits(['update:show', 'update:sources']);

// ==================== 状态管理 ====================
const { t } = useI18n();
const settingsStore = useSettingsStore();
const message = useMessage();
const visible = ref(props.show);
const selectedSources = ref<Platform[]>([...props.sources]);
const activeTab = ref('sources');
const { allSources } = useMusicSources();
const nasKey = ref('');
const nasConnecting = ref(false);
const handleNasConnect = async () => {
  nasConnecting.value = true;
  try {
    await connectNas(nasKey.value);
    nasKey.value = '';
    message.success('播放器服务已连接');
  } catch (error: any) { message.error(error.message); }
  finally { nasConnecting.value = false; }
};

const tabs = computed(() => [
  { key: 'sources', label: t('settings.playback.lxMusic.tabs.sources') },
  { key: 'lxMusic', label: t('settings.playback.lxMusic.tabs.lxMusic') },
  ...(!isNasMode ? [{ key: 'customApi', label: t('settings.playback.lxMusic.tabs.customApi') }] : [])
]);

// 落雪音源列表（从 store 中的脚本解析）
const lxMusicApis = computed<LxMusicScriptConfig[]>(() => {
  const scripts = settingsStore.setData.lxMusicScripts || [];
  return isNasMode ? orderedLxScripts(settingsStore.setData) : scripts;
});

const lxAutoSwitch = computed(() => settingsStore.setData.lxAutoSwitch !== false);
const isLxSelected = (api: LxMusicScriptConfig) => isNasMode && lxAutoSwitch.value ?
  api.enabled !== false : activeLxApiId.value === api.id;

const saveNasLxOrder = (scripts: LxMusicScriptConfig[], order: string[]) => {
  const first = order.map(id => scripts.find(api => api.id === id))
    .find(api => api && api.enabled !== false && api.sources.some(source => ['wy', 'tx', 'kg'].includes(source)));
  settingsStore.setSetData({ lxMusicScripts: scripts, lxMusicPriority: order,
    activeLxMusicApiId: first?.id || null });
  if (first && !selectedSources.value.includes('lxMusic')) selectedSources.value.push('lxMusic');
};
const setLxAutoSwitch = (value: boolean) => settingsStore.setSetData({ lxAutoSwitch: value });
const toggleLxEnabled = (id: string) => {
  const scripts = lxMusicApis.value.map(api => api.id === id ? { ...api, enabled: api.enabled === false } : api);
  saveNasLxOrder(scripts, scripts.map(api => api.id));
};
const moveLxApi = (id: string, direction: number) => {
  const order = lxMusicApis.value.map(api => api.id);
  const index = order.indexOf(id), target = index + direction;
  if (index < 0 || target < 0 || target >= order.length) return;
  [order[index], order[target]] = [order[target], order[index]];
  saveNasLxOrder(lxMusicApis.value, order);
};

// 当前激活的音源 ID
const activeLxApiId = computed<string | null>({
  get: () => settingsStore.setData.activeLxMusicApiId || null,
  set: (id: string | null) => {
    settingsStore.setSetData({ activeLxMusicApiId: id });
  }
});

// 落雪音源脚本信息（保持向后兼容）
const lxMusicScriptInfo = computed<LxScriptInfo | null>(() => {
  const activeId = activeLxApiId.value;
  if (!activeId) {
    return null;
  }
  const activeApi = lxMusicApis.value.find((api: LxMusicScriptConfig) => api.id === activeId);
  return activeApi?.info || null;
});

// URL 导入相关状态
const lxScriptUrl = ref('');
const isImportingFromUrl = ref(false);

// 重命名相关状态
const editingScriptId = ref<string | null>(null);
const editingName = ref('');
const renameInputRef = ref<HTMLInputElement | null>(null);

// ==================== 计算属性 ====================
const isSourceSelected = (sourceKey: string): boolean => {
  return selectedSources.value.includes(sourceKey as Platform);
};

// ==================== 方法 ====================
/**
 * 切换音源选择状态
 */
const toggleSource = (sourceKey: string) => {
  // 检查是否是自定义API且未导入
  if (sourceKey === 'custom' && !settingsStore.setData.customApiPlugin) {
    message.warning(t('settings.playback.customApi.enableHint'));
    activeTab.value = 'customApi';
    return;
  }

  // 检查是否是落雪音源且未配置
  if (sourceKey === 'lxMusic') {
    if (lxMusicApis.value.length === 0) {
      message.warning(t('settings.playback.lxMusic.scripts.noScriptWarning'));
      activeTab.value = 'lxMusic';
      return;
    }
    if (!activeLxApiId.value) {
      message.warning(t('settings.playback.lxMusic.scripts.noSelectionWarning'));
      activeTab.value = 'lxMusic';
      return;
    }
  }

  const index = selectedSources.value.indexOf(sourceKey as Platform);
  if (index > -1) {
    // 至少保留一个音源
    if (selectedSources.value.length <= 1) {
      message.warning(t('settings.playback.musicSourcesWarning'));
      return;
    }
    selectedSources.value.splice(index, 1);
  } else {
    selectedSources.value.push(sourceKey as Platform);
  }
};

/**
 * 导入自定义API插件
 */
const importPlugin = async () => {
  try {
    const result = await window.api.importCustomApiPlugin();
    if (result && result.name && result.content) {
      settingsStore.setCustomApiPlugin(result);
      message.success(t('settings.playback.customApi.importSuccess', { name: result.name }));

      // 导入成功后自动勾选
      if (!selectedSources.value.includes('custom')) {
        selectedSources.value.push('custom');
      }
    }
  } catch (error: any) {
    message.error(t('settings.playback.customApi.importFailed', { message: error.message }));
  }
};

/**
 * 导入落雪音源脚本
 */
const importLxMusicScript = async () => {
  try {
    if (isNasMode) {
      if (!nasConnected.value) await refreshNasConnection();
      if (!nasConnected.value) throw new Error('请先输入本实例的访问密钥连接播放器服务');
      const content = await importNasScript();
      if (content) await addLxMusicScript(content);
      return;
    }
    const result = await window.api.importLxMusicScript();
    if (result && result.content) {
      await addLxMusicScript(result.content);
    }
  } catch (error: any) {
    console.error('导入落雪音源脚本失败:', error);
    message.error(`${t('common.error')}：${error.message}`);
  }
};

/**
 * 添加落雪音源脚本到列表
 */
const addLxMusicScript = async (scriptContent: string) => {
  // 解析脚本信息
  const scriptInfo = parseScriptInfo(scriptContent);

  // 尝试初始化执行器以验证脚本
  try {
    const runner = await initLxMusicRunner(scriptContent);
    const sources = runner.getSources();
    const sourceKeys = Object.keys(sources) as LxSourceKey[];
    if (isNasMode && !sourceKeys.some(source => ['wy', 'tx', 'kg'].includes(source))) {
      throw new Error('此脚本没有提供网易云、QQ 或酷狗的可用音源');
    }

    // 生成唯一 ID
    const id = `lx_api_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

    // 创建新的脚本配置
    const newApiConfig: LxMusicScriptConfig = {
      id,
      name: scriptInfo.name,
      script: scriptContent,
      info: scriptInfo,
      sources: sourceKeys,
      enabled: true,
      createdAt: Date.now()
    };

    // 添加到列表
    const scripts = [...(settingsStore.setData.lxMusicScripts || []), newApiConfig];

    if (isNasMode) {
      // New scripts join as backups. Importing one does not silently change the first choice.
      saveNasLxOrder(scripts, [...lxMusicApis.value.map(api => api.id), id]);
    } else settingsStore.setSetData({ lxMusicScripts: scripts, activeLxMusicApiId: id });

    message.success(`${t('common.success')}：${scriptInfo.name}`);

    // 导入成功后自动勾选
    if (!selectedSources.value.includes('lxMusic')) {
      selectedSources.value.push('lxMusic');
    }
  } catch (initError: any) {
    console.error('[MusicSourceSettings] 落雪音源脚本初始化失败:', initError);
    message.error(`${t('common.error')}：${initError.message}`);
  }
};

/**
 * 设置激活的落雪音源
 */
const setActiveLxApi = async (apiId: string) => {
  const api = lxMusicApis.value.find((a: LxMusicScriptConfig) => a.id === apiId);
  if (!api) {
    message.error(t('settings.playback.lxMusic.scripts.notFound'));
    return;
  }

  if (isNasMode) {
    const scripts = lxMusicApis.value.map(item => item.id === apiId ? { ...item, enabled: true } : item);
    saveNasLxOrder(scripts, [apiId, ...scripts.filter(item => item.id !== apiId).map(item => item.id)]);
    return;
  }

  try {
    // 清除旧的 runner
    setLxMusicRunner(null);

    // 初始化新选中的脚本
    await initLxMusicRunner(api.script);

    // 更新激活的音源 ID
    activeLxApiId.value = apiId;

    // 确保 lxMusic 在已选音源中
    if (!selectedSources.value.includes('lxMusic')) {
      selectedSources.value.push('lxMusic');
    }

    message.success(t('settings.playback.lxMusic.scripts.switched', { name: api.name }));
  } catch (error: any) {
    console.error('[MusicSourceSettings] 切换落雪音源失败:', error);
    message.error(`${t('common.error')}：${error.message}`);
  }
};

/**
 * 删除落雪音源
 */
const removeLxApi = (apiId: string) => {
  const scripts = [...(settingsStore.setData.lxMusicScripts || [])];
  const index = scripts.findIndex((s) => s.id === apiId);

  if (index === -1) return;

  const removedScript = scripts[index];
  scripts.splice(index, 1);

  if (isNasMode) {
    saveNasLxOrder(scripts, lxMusicApis.value.filter(api => api.id !== apiId).map(api => api.id));
    message.success(t('settings.playback.lxMusic.scripts.deleted', { name: removedScript.name }));
    return;
  }

  // 更新 store
  settingsStore.setSetData({
    lxMusicScripts: scripts
  });

  // 如果删除的是当前激活的音源
  if (activeLxApiId.value === apiId) {
    // 自动选择下一个可用音源，或者清空
    if (scripts.length > 0) {
      setActiveLxApi(scripts[0].id);
    } else {
      setLxMusicRunner(null);
      settingsStore.setSetData({ activeLxMusicApiId: null });
      // 从已选音源中移除 lxMusic
      const srcIndex = selectedSources.value.indexOf('lxMusic');
      if (srcIndex > -1) {
        selectedSources.value.splice(srcIndex, 1);
      }
    }
  }

  message.success(t('settings.playback.lxMusic.scripts.deleted', { name: removedScript.name }));
};

/**
 * 从 URL 导入落雪音源脚本
 */
const importLxMusicScriptFromUrl = async () => {
  const url = lxScriptUrl.value.trim();
  if (!url) {
    message.warning(t('settings.playback.lxMusic.scripts.enterUrl'));
    return;
  }

  // 验证 URL 格式
  try {
    new URL(url);
  } catch {
    message.error(t('settings.playback.lxMusic.scripts.invalidUrl'));
    return;
  }

  isImportingFromUrl.value = true;

  try {
    // 下载脚本内容
    let content: string;
    if (isNasMode) {
      const response = await nasHttpRequest(url, { method: 'GET' });
      if (response.statusCode !== 200 || typeof response.body !== 'string')
        throw new Error(`脚本下载失败 (${response.statusCode})`);
      content = response.body;
    } else {
      const response = await fetch(url);
      if (!response.ok) throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      content = await response.text();
    }

    // 验证脚本格式 - 检查是否包含 lx-music 脚本的特征
    // 1. 检查是否有头部注释块（包含 @name、@version 等）
    const hasHeaderComment = /^\/\*+[\s\S]*?@name[\s\S]*?\*\//.test(content);
    // 2. 检查是否使用 lx API（lx.on 或 lx.send）
    const hasLxApi = content.includes('lx.on(') || content.includes('lx.send(');

    if (!hasHeaderComment && !hasLxApi) {
      throw new Error(t('settings.playback.lxMusic.scripts.invalidScript'));
    }

    // 使用统一的添加方法
    await addLxMusicScript(content);

    // 清空 URL 输入框
    lxScriptUrl.value = '';
  } catch (error: any) {
    console.error('从 URL 导入落雪音源脚本失败:', error);
    message.error(
      `${t('settings.playback.lxMusic.scripts.importOnline')} ${t('common.error')}：${error.message}`
    );
  } finally {
    isImportingFromUrl.value = false;
  }
};

/**
 * 开始重命名
 */
const startRenaming = (api: LxMusicScriptConfig) => {
  editingScriptId.value = api.id;
  editingName.value = api.name;
  nextTick(() => {
    renameInputRef.value?.focus();
  });
};

/**
 * 保存脚本名称
 */
const saveScriptName = (apiId: string) => {
  if (!editingName.value.trim()) {
    message.warning(t('settings.playback.lxMusic.scripts.nameRequired'));
    return;
  }

  const scripts = [...(settingsStore.setData.lxMusicScripts || [])];
  const index = scripts.findIndex((s) => s.id === apiId);

  if (index > -1) {
    scripts[index] = {
      ...scripts[index],
      name: editingName.value.trim()
    };

    settingsStore.setSetData({
      lxMusicScripts: scripts
    });

    message.success(t('settings.playback.lxMusic.scripts.renameSuccess'));
  }

  editingScriptId.value = null;
  editingName.value = '';
};

/**
 * 确认选择
 */
const handleConfirm = () => {
  const defaultPlatforms: Platform[] = isNasMode ? ['lxMusic'] : ['migu', 'kugou', 'kuwo', 'pyncmd'];
  const valuesToEmit =
    selectedSources.value.length > 0 ? [...new Set(selectedSources.value)] : defaultPlatforms;
  emit('update:sources', valuesToEmit);
  visible.value = false;
};

/**
 * 取消选择
 */
const handleCancel = () => {
  selectedSources.value = [...props.sources];
  visible.value = false;
};

// ==================== 监听器 ====================
// 监听自定义插件内容变化
watch(
  () => settingsStore.setData.customApiPlugin,
  (newPluginContent: any) => {
    if (!newPluginContent) {
      const index = selectedSources.value.indexOf('custom');
      if (index > -1) {
        selectedSources.value.splice(index, 1);
      }
    }
  }
);

// 监听落雪音源列表变化
watch(
  [() => lxMusicApis.value.length, () => activeLxApiId.value],
  ([apiCount, activeId]) => {
    // 如果没有音源或没有激活的音源，自动从已选音源中移除 lxMusic
    if (apiCount === 0 || !activeId) {
      const index = selectedSources.value.indexOf('lxMusic');
      if (index > -1) {
        selectedSources.value.splice(index, 1);
      }
    }
  },
  { deep: true }
);

// 同步外部show属性变化
watch(
  () => props.show,
  (newVal: boolean) => {
    visible.value = newVal;
  }
);

// 同步内部visible变化
watch(
  () => visible.value,
  (newVal: boolean) => {
    emit('update:show', newVal);
  }
);

// 同步外部sources属性变化
watch(
  () => props.sources,
  (newVal: Platform[]) => {
    selectedSources.value = [...newVal];
  },
  { deep: true }
);
</script>

<style scoped>
.fade-enter-active,
.fade-leave-active {
  transition: opacity 0.2s ease;
}

.fade-enter-from,
.fade-leave-to {
  opacity: 0;
}
</style>
