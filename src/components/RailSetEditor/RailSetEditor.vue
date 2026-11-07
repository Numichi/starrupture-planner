<!--
  RailSetEditor – count per rail tier of a manual rail set (logic: RailSetEditor.ts).
-->
<template>
  <div class="rail-set">
    <div
      v-for="t in available"
      :key="t.name"
      class="rail-row"
      :class="{ 'rail-row--on': (counts.get(t.name) ?? 0) > 0 }"
    >
      <span class="rail-name">{{ t.name }}</span>
      <span class="rail-cap muted">{{ formatRate(t.capacity) }} {{ RATE_UNIT_LABEL }}</span>

      <div class="stepper">
        <button
          type="button"
          class="icon-btn"
          title="One less"
          :disabled="!canDecrease(t.name)"
          @click="step(t.name, -1)"
        >
          −
        </button>
        <input
          type="number"
          min="0"
          step="1"
          :value="counts.get(t.name) ?? 0"
          :aria-label="`Number of ${t.name} rails`"
          @change="onInput(t.name, $event)"
        />
        <button type="button" class="icon-btn" title="One more" @click="step(t.name, 1)">+</button>
      </div>
    </div>

    <div v-for="[name, c] in unavailable" :key="name" class="rail-row rail-row--bad">
      <span class="rail-name">{{ name }}</span>
      <span class="rail-cap">{{ c }} pcs · not available (computed with the best available)</span>
      <button type="button" class="icon-btn" title="Delete" @click="set(name, 0)">×</button>
    </div>

    <div class="rail-sum">
      <template v-if="resolved.parts.length">
        <strong>{{ partsLabel(resolved.parts) }}</strong> = {{ formatRate(capacity) }} {{ RATE_UNIT_LABEL }}
      </template>
      <span v-else class="muted">No rail set (at least one is needed).</span>
    </div>
  </div>
</template>

<script lang="ts" src="./RailSetEditor.ts"></script>
<style lang="scss" scoped src="./RailSetEditor.scss"></style>
