<!--
  GraphEdge – one drone rail between two nodes: the line (part="line") or its label (part="label")
  (logic: GraphEdge.ts, styles: GraphEdge.scss).
-->
<template>
  <g v-if="part === 'line'" class="edge" :class="lineClass" :data-link-id="pos.edge.linkId">
    <!-- A wider, transparent line below: easier to hit with the mouse. -->
    <path class="edge-hit" :d="d" />
    <path v-for="s in stubs" :key="'hit' + s.key" class="edge-hit" :d="s.d" />
    <path
      v-for="s in stubs"
      :key="s.key"
      class="edge-line edge-stub"
      :d="s.d"
      :stroke="stubStroke(s.color)"
      :stroke-width="stubWidth"
    />
    <path class="edge-line" :d="d" :stroke="stroke" :stroke-width="strokeWidth" />
    <title>{{ tooltip }}</title>
  </g>

  <g
    v-else
    class="edge edge-label"
    :class="labelClass"
    :transform="`translate(${label.x - labelWidth / 2},${label.y - LABEL_HEIGHT / 2})`"
    :data-link-id="pos.edge.linkId"
  >
    <rect :width="labelWidth" :height="LABEL_HEIGHT" rx="9" class="edge-label-bg" :stroke="stroke" />
    <ItemIcon
      v-for="(it, i) in items"
      :key="it.id"
      :item="it"
      :size="ICON"
      :x="iconX(i)"
      :y="LABEL_HEIGHT / 2"
    />
    <text class="edge-label-text" :x="textX" :y="LABEL_HEIGHT / 2">{{ text }}</text>

    <g v-if="badge" :transform="`translate(${textX + textWidth + 5},3)`">
      <rect :width="badgeWidth" height="12" rx="6" class="rail-badge" />
      <text class="rail-badge-text" :x="badgeWidth / 2" y="6">{{ badge }}</text>
    </g>

    <title>{{ tooltip }}</title>
  </g>
</template>

<script lang="ts" src="./GraphEdge.ts"></script>
<style lang="scss" scoped src="./GraphEdge.scss"></style>
