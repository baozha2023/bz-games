<template>
    <n-modal v-model:show="show" preset="card" :title="t('achievement.title')" style="width: 600px;">
        <n-empty v-if="achievements.length === 0" :description="t('achievement.noAchievements')" />
        <n-list v-else>
            <n-list-item v-for="ach in achievements" :key="ach.id">
                <n-thing>
                    <template #avatar>
                        <n-icon size="24" :color="ach.unlocked ? '#f0a020' : '#ccc'">
                             <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path fill="currentColor" d="M20.2 2H3.8C2.8 2 2 2.8 2 3.8v4.4c0 1 .8 1.8 1.8 1.8h.4c.5 2.8 3 4.9 6 5v.5c0 .8.7 1.5 1.5 1.5h.6v2h-2c-1.1 0-2 .9-2 2s.9 2 2 2h7.4c1.1 0 2-.9 2-2s-.9-2-2-2h-2v-2h.6c.8 0 1.5-.7 1.5-1.5v-.5c3-.1 5.5-2.2 6-5h.4c1 0 1.8-.8 1.8-1.8V3.8C22 2.8 21.2 2 20.2 2M5.8 8h-2V4h2zm14.4 0h-2V4h2z"/></svg>
                        </n-icon>
                    </template>
                    <template #header>{{ ach.title }}</template>
                    <template #description>{{ ach.description }}</template>
                    <template #header-extra>
                        <n-tag type="success" v-if="ach.unlocked">{{ t('achievement.unlocked') }}</n-tag>
                        <n-tag type="default" v-else>{{ t('achievement.locked') }}</n-tag>
                    </template>
                </n-thing>
            </n-list-item>
        </n-list>
    </n-modal>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { NModal, NEmpty, NList, NListItem, NThing, NIcon, NTag } from 'naive-ui'

const { t } = useI18n()

const props = defineProps<{
    show: boolean
    achievements: any[]
}>()

const emit = defineEmits<{
    (e: 'update:show', value: boolean): void
}>()

const show = computed({
    get: () => props.show,
    set: (val) => emit('update:show', val)
})
</script>
