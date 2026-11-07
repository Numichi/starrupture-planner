<!--
  SpecialNode – mine, Receiver, Dispatcher, storage and inter-base rail nodes
  (logic: SpecialNode.ts, styles: SpecialNode.scss).
-->
<template>
  <g class="special" :class="rootClass" :transform="`translate(${pos.x},${pos.y})`" :data-node-id="node.id">
    <title>{{ tooltip }}</title>

    <rect class="special-glow" x="-5" y="-5" :width="w + 10" :height="h + 10" rx="11" />
    <rect class="special-box" :width="w" :height="h" rx="7" />
    <path class="special-header" :d="headerPath" />
    <image
      v-if="buildingIcon"
      :href="buildingIcon"
      x="7"
      :y="NODE.headerHeight / 2 - 8"
      width="16"
      height="16"
      @error="iconFailed = true"
    />
    <text class="special-title" :x="buildingIcon ? 28 : 10" :y="NODE.headerHeight / 2">{{ titleText }}</text>
    <text class="special-kind" :x="w - 10" :y="NODE.headerHeight / 2">
      <tspan v-if="node.upgradable" class="special-upgrade">↑ </tspan>{{ kindLabel }}
    </text>

    <!-- Item rows: the left half is the input, the right half the output -->
    <g v-for="r in rows" :key="r.p.id">
      <rect
        v-if="r.inPort"
        class="port-hit"
        x="2"
        :y="r.y - 13"
        :width="r.outPort ? w / 2 - 2 : w - 4"
        height="26"
        rx="5"
        data-port-dir="in"
        :data-port-item="r.p.item"
        @pointerdown.stop="onPort('in', r.p.item, $event)"
      />
      <rect
        v-if="r.outPort"
        class="port-hit"
        :x="r.inPort ? w / 2 : 2"
        :y="r.y - 13"
        :width="r.inPort ? w / 2 - 2 : w - 4"
        height="26"
        rx="5"
        data-port-dir="out"
        :data-port-item="r.p.item"
        @pointerdown.stop="onPort('out', r.p.item, $event)"
      />
      <ItemIcon class="row-icon" :item="r.item" :size="16" :x="20" :y="r.y" />
      <text class="special-item" x="34" :y="r.y">
        <title>{{ r.item.name }}</title>
        {{ rowName(r.item.name, r.rate) }}
      </text>
      <text class="special-rate" :x="w - 12" :y="r.y">
        {{ formatRate(r.rate) }}<tspan class="special-unit">{{ RATE_UNIT_LABEL }}</tspan>
      </text>
      <circle
        v-if="r.inPort"
        class="special-port"
        :class="{ 'special-port--open': !r.inPort.linked }"
        :cx="0"
        :cy="r.y"
        r="4"
      />
      <circle
        v-if="r.outPort"
        class="special-port"
        :class="{ 'special-port--open': !r.outPort.linked }"
        :cx="w"
        :cy="r.y"
        r="4"
      />
    </g>

    <text v-if="rows.length === 0" class="special-empty" :x="w / 2" :y="emptyY">{{ emptyText }}</text>

    <!-- Footer -->
    <template v-if="isRail">
      <text
        class="special-footer special-link"
        :class="{ 'special-footer--bad': node.warning }"
        x="10"
        :y="footerLineY(node, 0)"
        @pointerdown.stop
        @click.stop="goto"
      >
        {{ footer(node.warning ?? linkLine?.text ?? '', railReserve) }}
      </text>
      <text
        class="special-footer special-footer--end"
        :class="{ 'special-footer--warn': (node.rail?.count ?? 1) > 1 }"
        :x="w - 10"
        :y="footerLineY(node, 0)"
      >
        {{ railText }}
      </text>
    </template>

    <template v-else>
      <text
        v-if="linkLine"
        class="special-footer"
        :class="{ 'special-link': linkLine.target }"
        x="10"
        :y="footerLineY(node, 0)"
        @pointerdown="onLinkPointerDown"
        @click.stop="goto"
      >
        {{ footer(linkLine.text) }}
      </text>
      <text
        v-if="statusLine"
        class="special-footer"
        :class="{ 'special-footer--bad': statusLine.bad, 'special-footer--warn': statusLine.warn }"
        x="10"
        :y="footerLineY(node, 1)"
      >
        {{ footer(statusLine.text) }}
      </text>
    </template>
  </g>
</template>

<script lang="ts" src="./SpecialNode.ts"></script>
<style lang="scss" scoped src="./SpecialNode.scss"></style>
