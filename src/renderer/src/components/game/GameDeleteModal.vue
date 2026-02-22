<template>
    <n-modal v-model:show="show" preset="dialog" :title="t('gameDetail.deleteGame')" :positive-text="t('common.delete')" :negative-text="t('common.cancel')" @positive-click="handleConfirm" :loading="loading" :positive-button-props="{ disabled: selectedVersions.length === 0 }" type="error">
        <div style="margin-bottom: 12px;">{{ t('common.confirmDelete') }}</div>
        <n-checkbox-group v-model:value="selectedVersions">
            <n-space vertical>
                <n-checkbox v-for="v in versions" :key="v" :value="v" :label="v" />
            </n-space>
        </n-checkbox-group>
        <div style="margin-top: 12px; font-size: 12px; color: #999;" v-if="selectedVersions.length === versions.length">
            {{ t('gameDetail.deleteAllVersionsWarning') }}
        </div>
    </n-modal>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { NModal, NCheckboxGroup, NSpace, NCheckbox } from 'naive-ui'

const { t } = useI18n()

const props = defineProps<{
    show: boolean
    versions: string[]
    initialSelected: string[]
    loading?: boolean
}>()

const emit = defineEmits<{
    (e: 'update:show', value: boolean): void
    (e: 'confirm', versions: string[]): void
}>()

const show = computed({
    get: () => props.show,
    set: (val) => emit('update:show', val)
})

const selectedVersions = ref<string[]>([])

watch(() => props.show, (val) => {
    if (val) {
        selectedVersions.value = [...props.initialSelected];
    }
})

const handleConfirm = () => {
    emit('confirm', selectedVersions.value)
    return false // Prevent auto-close if loading
}
</script>
