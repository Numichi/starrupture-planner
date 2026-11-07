<!--
  LineNode – rail line (collector) node: header with rail set, item rows, free inputs, load footer
  (logic: LineNode.ts, styles: LineNode.scss).
-->
<template>
  <g class="line-node" :class="rootClass" :transform="`translate(${pos.x},${pos.y})`" :data-node-id="node.id">
    <title>{{ tooltip }}</title>

    <rect class="line-glow" x="-5" y="-5" :width="w + 10" :height="h + 10" rx="12" />
    <rect class="line-box" :width="w" :height="h" rx="8" />

    <!-- Header: rail band with a sleeper pattern -->
    <path class="line-header" :d="headerPath" />
    <line class="line-rail" x1="10" :x2="w - 10" :y1="NODE.headerHeight - 3" :y2="NODE.headerHeight - 3" />
    <text class="line-title" x="10" :y="NODE.headerHeight / 2 - 1">{{ titleText }}</text>

    <g v-if="badge" :transform="`translate(${w - 10 - badgeWidth},${NODE.headerHeight / 2 - 8})`">
      <rect
        :width="badgeWidth"
        height="14"
        rx="7"
        class="line-badge"
        :class="{ 'line-badge--bad': congested, 'line-badge--warn': scaled }"
      />
      <text class="line-badge-text" :class="{ 'line-badge-text--on': congested }" :x="badgeWidth / 2" y="7">
        {{ badge }}
      </text>
    </g>

    <!-- Item rows: left half input, right half output -->
    <g v-for="r in rows" :key="r.p.id">
      <rect
        class="port-hit"
        x="2"
        :y="r.y - ROW_HEIGHT / 2 + 2"
        :width="w / 2 - 2"
        :height="ROW_HEIGHT - 4"
        rx="5"
        data-port-dir="in"
        :data-port-item="r.p.item"
        @pointerdown.stop="onPort('in', r.p.item, $event)"
      />
      <rect
        class="port-hit"
        :x="w / 2"
        :y="r.y - ROW_HEIGHT / 2 + 2"
        :width="w / 2 - 2"
        :height="ROW_HEIGHT - 4"
        rx="5"
        data-port-dir="out"
        :data-port-item="r.p.item"
        @pointerdown.stop="onPort('out', r.p.item, $event)"
      />
      <ItemIcon class="row-icon" :item="r.item" :size="14" :x="18" :y="r.y" />
      <text class="line-item" x="30" :y="r.y">{{ rowName(r.item.name, r.p.flow) }}</text>
      <text class="line-rate" :x="w - 14" :y="r.y">{{ formatRate(r.p.flow) }}</text>
      <circle class="line-port" :cx="0" :cy="r.y" r="3.5" />
      <circle class="line-port" :cx="w" :cy="r.y" r="3.5" />
    </g>

    <!-- Free inputs -->
    <g v-for="(y, k) in freeRows" :key="'free' + k" class="line-free">
      <rect x="10" :y="y - ROW_HEIGHT / 2 + 4" :width="w - 20" :height="ROW_HEIGHT - 8" rx="6" />
      <text :x="w / 2" :y="y">{{ rows.length ? '+ free input' : '+ drag a link here' }}</text>
      <circle class="line-port line-port--free" :cx="0" :cy="y" r="3.5" />
    </g>

    <!-- Footer: total flow / capacity, load, state -->
    <text class="line-total" x="10" :y="footerLineY(node, 0)">
      Σ {{ formatRate(shownTotal)
      }}<tspan class="line-cap"> / {{ formatRate(capacity) }} {{ RATE_UNIT_LABEL }}</tspan>
    </text>
    <rect class="line-bar" :x="barX" :y="footerLineY(node, 0) - 3" :width="BAR_WIDTH" height="6" rx="3" />
    <rect
      class="line-bar-fill"
      :class="{ 'line-bar-fill--bad': congested, 'line-bar-fill--warn': scaled }"
      :x="barX"
      :y="footerLineY(node, 0) - 3"
      :width="BAR_WIDTH * fill"
      height="6"
      rx="3"
    />
    <text
      class="line-status"
      :class="status.tone ? `line-status--${status.tone}` : ''"
      x="10"
      :y="footerLineY(node, 1)"
    >
      {{ statusText }}
    </text>
  </g>
</template>

<script lang="ts" src="./LineNode.ts"></script>
<style lang="scss" scoped src="./LineNode.scss"></style>
