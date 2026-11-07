<!--
  RailLineEditor – name, sizing (auto / manual rail set), inputs, load state and items of a rail line
  (logic: RailLineEditor.ts, styles: RailLineEditor.scss).
-->
<template>
  <template v-if="line">
    <label class="field">
      <span>Name</span>
      <input type="text" :value="line.name" @input="setName" />
    </label>

    <!-- Sizing -->
    <div class="field">
      <span>Sizing</span>
      <div class="segmented" role="radiogroup" aria-label="Sizing">
        <button
          type="button"
          role="radio"
          :aria-checked="line.mode === 'auto'"
          :class="{ active: line.mode === 'auto' }"
          @click="setMode('auto')"
        >
          Automatic
        </button>
        <button
          type="button"
          role="radio"
          :aria-checked="line.mode === 'manual'"
          :class="{ active: line.mode === 'manual' }"
          @click="setMode('manual')"
        >
          Manual
        </button>
      </div>
    </div>

    <div v-if="line.mode === 'manual'" class="field">
      <span>Rails (count per tier, mixed allowed)</span>
      <RailSetEditor :rails="line.rails" :available="availableRails" @update="setRails" />
    </div>

    <p v-if="rail?.tierUnavailable" class="hint bad">
      A chosen tier is not among the available ones; computed with the best available ({{
        availableRails.at(-1)?.name
      }}).
    </p>

    <!-- Inputs -->
    <div class="field">
      <span>Inputs (items)</span>
      <div class="slots">
        <label class="check">
          <input type="radio" :checked="line.slots === null" @change="update({ slots: null })" />
          Dynamic
        </label>
        <label class="check">
          <input type="radio" :checked="line.slots !== null" @change="update({ slots: fixedSlots })" />
          Fixed:
          <input
            type="number"
            min="1"
            step="1"
            class="slots-input"
            :value="line.slots ?? fixedSlots"
            :disabled="line.slots === null"
            aria-label="Number of inputs"
            @change="setSlots"
          />
        </label>
        <span class="muted">{{ slotsText }}</span>
      </div>
    </div>

    <!-- State -->
    <div v-if="info && rail" class="editor-status" :class="{ 'status--bad': info.congested }">
      <div>
        Rail: <strong>{{ railLabel(rail) }}</strong> = {{ formatRate(rail.capacity) }} {{ RATE_UNIT_LABEL }}
        <span class="muted">({{ rail.mode === 'auto' ? 'automatic' : 'manual' }})</span>
      </div>
      <div>
        Total flow: <strong>{{ formatRate(info.total) }}</strong> {{ RATE_UNIT_LABEL }}
        <span class="muted">· {{ Math.round(rail.load * 100) }}%</span>
      </div>

      <div class="meter" :class="{ 'meter--bad': info.congested, 'meter--warn': scaled }">
        <div :style="{ width: meterWidth }" />
      </div>

      <div v-if="scaled" class="warn-line">
        One {{ rail.tier.name }} rail carries {{ formatRate(rail.tier.capacity) }} {{ RATE_UNIT_LABEL }}: this
        flow needs {{ rail.count }} parallel rails ({{ railLabel(rail) }}).
      </div>

      <template v-if="info.congested">
        <div class="bad">
          <strong>Congestion:</strong> {{ formatRate(info.demand) }} {{ RATE_UNIT_LABEL }} would pass, the
          rail only lets {{ formatRate(rail.capacity) }} through. The consumers get less.
        </div>
        <div class="btn-row">
          <button type="button" class="link-btn" @click="setRails(toCounts(rail.needed))">
            Set {{ partsLabel(rail.needed) }}
          </button>
          <button type="button" class="link-btn" @click="setMode('auto')">Automatic sizing</button>
        </div>
      </template>
    </div>

    <div v-if="items.length" class="field">
      <span>Items on the line</span>
      <div v-for="x in items" :key="x.id" class="item-row">
        <ItemIcon standalone :item="x.item" :size="14" />
        <span class="item-name">{{ x.item.name }}</span>
        <span class="num">{{ formatRate(x.flow) }}</span>
        <span class="muted share">{{ Math.round(x.share * 100) }}%</span>
      </div>
    </div>
    <p v-else class="hint">No items on the line yet: drag a link onto it from a producer's output.</p>

    <p v-if="node?.warning && !info?.congested" class="hint bad">{{ node.warning }}</p>

    <p class="hint">
      Collector: several sources fill it, several consumers take from it; one rail carries several items (in
      on the left, the same out on the right). The capacity counts the total flow (the sum of the items). In
      automatic mode the smallest tier that carries it, or as many of the best as needed (a smaller one for
      the rest); in manual mode the configured rail set (mixed tiers allowed) is the limit.
    </p>

    <div class="btn-row">
      <button type="button" class="danger-btn" @click="confirmRemove">Delete rail line</button>
    </div>
  </template>

  <p v-else class="hint">This rail line no longer exists.</p>
</template>

<script lang="ts" src="./RailLineEditor.ts"></script>
<style lang="scss" scoped src="./RailLineEditor.scss"></style>
