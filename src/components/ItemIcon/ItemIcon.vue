<!--
  ItemIcon – item image, or a coloured circle with the short label (logic: ItemIcon.ts).
-->
<template>
  <svg v-if="standalone" class="item-icon-standalone" :width="size" :height="size" aria-hidden="true">
    <g>
      <image v-if="showImage" :href="item.icon" :width="size" :height="size" @error="failed = true" />
      <template v-else>
        <circle :cx="cx" :cy="cy" :r="size / 2" :fill="item.color" />
        <text :x="cx" :y="cy" :font-size="fontSize" :fill="textColor" class="item-icon-text">
          {{ label }}
        </text>
      </template>
    </g>
    <title>{{ item.name }}</title>
  </svg>

  <g v-else class="item-icon">
    <image
      v-if="showImage"
      :href="item.icon"
      :x="x - size / 2"
      :y="y - size / 2"
      :width="size"
      :height="size"
      @error="failed = true"
    />
    <template v-else>
      <circle :cx="cx" :cy="cy" :r="size / 2" :fill="item.color" />
      <text :x="cx" :y="cy" :font-size="fontSize" :fill="textColor" class="item-icon-text">{{ label }}</text>
    </template>
  </g>
</template>

<script lang="ts" src="./ItemIcon.ts"></script>
<style lang="scss" scoped src="./ItemIcon.scss"></style>
