<!--
  GraphNode – factory node: input / output rows, building, machine count with auto / manual mode, power
  (logic: GraphNode.ts, styles: GraphNode.scss).
-->
<template>
  <g class="node" :class="rootClass" :transform="`translate(${pos.x},${pos.y})`" :data-node-id="node.id">
    <title>{{ tooltip }}</title>

    <rect class="node-glow" x="-5" y="-5" :width="w + 10" :height="h + 10" rx="11" />
    <rect class="node-box" :width="w" :height="h" rx="6" />
    <path class="node-header" :d="headerPath" />

    <g v-if="note" class="node-nodata">
      <title>{{ note.text }}</title>
      <text :x="10" :y="NODE.headerHeight / 2">⚠︎</text>
    </g>

    <text class="node-title" :x="titleX" :y="NODE.headerHeight / 2">{{ titleText }}</text>
    <text v-if="node.upgradable" class="node-upgrade" :x="w - 10" :y="NODE.headerHeight / 2">↑</text>

    <g v-if="reduced" :transform="`translate(${percentX},${NODE.headerHeight / 2 - 8})`">
      <title>{{ percentTitle }}</title>
      <rect class="node-util" :width="percentWidth" height="16" rx="8" />
      <text class="node-util-text" :x="percentWidth / 2" y="8">{{ percent }}</text>
    </g>

    <!-- Inputs (left column) -->
    <g
      v-for="{ p, y } in inputRows"
      :key="p.id"
      class="port-row"
      data-port-dir="in"
      :data-port-item="p.item"
      @pointerdown.stop="onPort('in', p.item, $event)"
    >
      <title>{{ index.item(p.item).name }}: click (what supplies it?) or drag onto a producer</title>
      <rect class="port-hit" x="2" :y="y - 14" :width="NODE.sideColumnWidth" height="28" rx="5" />
      <ItemIcon :item="index.item(p.item)" :size="ICON" :x="10 + ICON / 2" :y="y" />
      <text class="node-rate" :class="{ 'node-rate--reduced': reduced }" :x="10 + ICON + 5" :y="y - 6">
        {{ shownRate(p) }}<tspan class="node-unit">{{ RATE_UNIT_LABEL }}</tspan>
      </text>
      <text class="node-per" :class="`tone-${status(p, 'in').tone}`" :x="10 + ICON + 5" :y="y + 7">
        {{ status(p, 'in').text }}
      </text>
      <circle
        class="node-port"
        :class="{ 'node-port--open': !p.linked, 'node-port--bad': p.gap > 0.001 }"
        :cx="0"
        :cy="y"
        r="4"
      />
    </g>

    <!-- Outputs (right column) -->
    <g
      v-for="{ p, y } in outputRows"
      :key="p.id"
      class="port-row"
      data-port-dir="out"
      :data-port-item="p.item"
      @pointerdown.stop="onPort('out', p.item, $event)"
    >
      <title>{{ index.item(p.item).name }}: click (what uses it?) or drag onto a consumer</title>
      <rect
        class="port-hit"
        :x="w - 2 - NODE.sideColumnWidth"
        :y="y - 14"
        :width="NODE.sideColumnWidth"
        height="28"
        rx="5"
      />
      <ItemIcon :item="index.item(p.item)" :size="ICON" :x="w - 10 - ICON / 2" :y="y" />
      <text
        class="node-rate node-rate--end"
        :class="{ 'node-rate--reduced': reduced }"
        :x="w - 10 - ICON - 5"
        :y="y - 6"
      >
        {{ shownRate(p) }}<tspan class="node-unit">{{ RATE_UNIT_LABEL }}</tspan>
      </text>
      <text
        class="node-per node-rate--end"
        :class="`tone-${status(p, 'out').tone}`"
        :x="w - 10 - ICON - 5"
        :y="y + 7"
      >
        {{ status(p, 'out').text }}
      </text>
      <circle class="node-port" :class="{ 'node-port--open': !p.linked }" :cx="w" :cy="y" r="4" />
    </g>

    <!-- Middle: building, machine count, power -->
    <text class="node-building" :x="w / 2" :y="centerY - 22">{{ buildingText }}</text>
    <image
      v-if="showBuildingIcon"
      :href="node.building?.icon"
      :x="countRowStart"
      :y="centerY + 1 - BUILDING_ICON / 2"
      :width="BUILDING_ICON"
      :height="BUILDING_ICON"
      @error="buildingIconFailed = true"
    />

    <!-- Machine count: click to type (switches to manual); next to it the auto / manual toggle -->
    <g v-if="!editingCount" class="node-count-hit" @pointerdown.stop @click.stop="startEdit">
      <title>Type the machine count (it becomes a manual count)</title>
      <rect :x="countX - 3" :y="centerY - 12" :width="countWidth + 6" height="26" rx="4" />
      <text class="node-count" :x="countX" :y="centerY + 1">{{ countText }}</text>
    </g>
    <foreignObject v-else :x="countX - 6" :y="centerY - 13" :width="EDIT_WIDTH" height="27" @pointerdown.stop>
      <input
        ref="countInput"
        class="node-count-input"
        type="text"
        inputmode="decimal"
        :value="editStart"
        aria-label="Machine count"
        @keydown="onCountKey"
        @blur="commitEdit"
      />
    </foreignObject>

    <g
      v-if="!editingCount"
      class="node-mode"
      :class="`node-mode--${mode}`"
      :transform="`translate(${modeX},${centerY - 7})`"
      @pointerdown.stop
      @click.stop="toggleMode"
    >
      <title>{{ modeTitle }}</title>
      <rect :width="modeWidth" height="15" rx="7.5" />
      <text :x="modeWidth / 2" y="7.5">{{ modeText }}</text>
    </g>

    <text class="node-power" :x="w / 2" :y="centerY + 22">{{ powerText }}</text>
  </g>
</template>

<script lang="ts" src="./GraphNode.ts"></script>
<style lang="scss" scoped src="./GraphNode.scss"></style>
