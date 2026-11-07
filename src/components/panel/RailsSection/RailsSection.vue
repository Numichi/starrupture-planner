<!--
  RailsSection – best rail tier, rail segments per tier, parallel and congested rails (logic: RailsSection.ts).
-->
<template>
  <section v-if="activeBase">
    <h2>Drone rails</h2>

    <template v-if="gameData.rails.length">
      <div class="field-label">Best available rail</div>
      <div class="segmented" role="radiogroup" aria-label="Best available rail">
        <button
          v-for="t in gameData.rails"
          :key="t.name"
          type="button"
          role="radio"
          :aria-checked="selectedRail === t.name"
          :class="{ active: selectedRail === t.name }"
          :title="`${formatRate(t.capacity)} ${RATE_UNIT_LABEL}`"
          @click="settings.maxRailName = t.name"
        >
          {{ t.name }} <span class="seg-sub">{{ formatRate(t.capacity) }}</span>
        </button>
      </div>
    </template>

    <div v-if="summary.rails.length" class="rail-summary">
      <span v-for="s in summary.rails" :key="s.tier.name" class="rail-chip">
        {{ s.tier.name }} <strong>× {{ s.lines }}</strong>
      </span>
      <span class="muted">rail segments</span>
    </div>

    <div v-if="summary.parallel" class="callout callout--warn">
      <strong>Several parallel rails are needed at {{ summary.parallel }} place(s)</strong>
      <div class="io-line">
        One rail (of the best available tier) cannot carry the flow, so the label reads e.g. "3× v.3" (amber).
        Click the link: distribution per rail, and how many source / receiving machines go on one rail.
      </div>
    </div>

    <div v-if="summary.congested" class="callout callout--error">
      <strong>Congestion: {{ congestedText }}</strong>
      <div class="io-line">
        The manually set rail is too small: the consumers would request more than it lets through (red). Click
        it: more or better rails, or automatic sizing.
      </div>
    </div>

    <p class="hint">
      Between two nodes one drone rail carries every item (one line on the graph). Automatically the smallest
      tier that carries its flow (when none does, as many of the best as needed, a smaller one for the rest),
      or set manually with a mixed rail set (click the line). A rail line (collector) counts its total flow
      (the sum of its items).
    </p>
  </section>
</template>

<script lang="ts" src="./RailsSection.ts"></script>
