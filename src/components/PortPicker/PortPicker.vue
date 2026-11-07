<!--
  PortPicker – "what supplies it? / what uses it?" popup of an item row
  (logic: PortPicker.ts, styles: PortPicker.scss).
-->
<template>
  <div class="picker-backdrop" @pointerdown="done" @contextmenu.prevent @wheel.prevent />

  <div ref="rootEl" class="picker" :style="pickerStyle" role="dialog" @pointerdown.stop>
    <header class="picker-head">
      <ItemIcon standalone :item="item" :size="20" />
      <div>
        <div class="picker-title">{{ item.name }}</div>
        <div class="picker-sub">
          {{ subtitle }}
          <template v-if="port && port.gap > 0.001">
            · {{ isInput ? 'missing' : 'left over' }} <strong>{{ formatRate(port.gap) }}</strong>
            {{ RATE_UNIT_LABEL }}
          </template>
        </div>
      </div>
      <button type="button" class="icon-btn" title="Close (Esc)" @click="done">×</button>
    </header>

    <input
      ref="searchEl"
      v-model="query"
      type="search"
      class="search"
      placeholder="Search: recipe, building, item…"
      aria-label="Search the options"
      @keydown.enter.prevent="pickFirst"
    />

    <!-- Existing links -->
    <template v-if="links.length">
      <div class="picker-group">Linked</div>
      <div v-for="l in links" :key="l.id" class="link-row">
        <span>{{ isInput ? '←' : '→' }} {{ title(isInput ? l.from : l.to) }}</span>
        <span class="muted">{{ formatRate(linkFlow(l.id)) }} {{ RATE_UNIT_LABEL }}</span>
        <button type="button" class="icon-btn" title="Delete link" @click="removeLink(l.id)">×</button>
      </div>
    </template>

    <button v-if="canChain" type="button" class="option option--chain" data-option @click="chain">
      <span class="option-name">⛓ Build chain down to the raw materials</span>
      <span class="option-meta"
        >for the missing {{ formatRate(gap) }} {{ RATE_UNIT_LABEL }}: factories and mines, linked</span
      >
    </button>

    <!-- Existing nodes (first on a click; last for a drop on empty canvas) -->
    <section v-if="candidates.length" class="candidates" :class="{ 'candidates--last': drop }">
      <div class="picker-group">
        {{ isInput ? 'Link from an existing node' : 'Link into an existing node' }}
      </div>
      <button
        v-for="c in candidates"
        :key="c.id"
        type="button"
        class="option option--small"
        data-option
        @click="connectTo(c.id)"
      >
        <span class="option-name"
          >{{ c.title }} <span v-if="c.note" class="muted">· {{ c.note }}</span></span
        >
      </button>
    </section>

    <!-- Amount (for an output) -->
    <div v-if="!isInput && recipes.length" class="amount">
      <label v-if="gap > 0.001" class="check">
        <input v-model="amountMode" type="radio" value="gap" />
        Use the remainder ({{ formatRate(gap) }} {{ RATE_UNIT_LABEL }})
      </label>
      <label class="check">
        <input v-model="amountMode" type="radio" value="machines" />
        Machines:
        <input
          v-model.number="machines"
          type="number"
          min="0"
          step="any"
          class="machines"
          aria-label="Number of machines"
          @focus="amountMode = 'machines'"
        />
      </label>
    </div>

    <!-- Mine (raw material) -->
    <template v-if="miners.length">
      <div class="picker-group">From a mine</div>
      <button
        v-for="b in miners"
        :key="b.id"
        type="button"
        class="option"
        data-option
        @click="chooseMine(b.id)"
      >
        <span class="option-name">{{ b.name }} <span v-if="b.upgradeOf" class="tag">↑ upgraded</span></span>
        <span class="option-io">
          {{ mineRateSummary(gameData, b, state.item) }}
          <span class="muted">{{ RATE_UNIT_LABEL }}/building</span>
        </span>
      </button>
    </template>

    <!-- New factory -->
    <template v-if="recipes.length">
      <div class="picker-group">New factory</div>
      <button
        v-for="o in recipes"
        :key="o.recipe.id"
        type="button"
        class="option"
        data-option
        @click="chooseRecipe(o.recipe)"
      >
        <span class="option-name">
          {{ o.recipe.name }} <span class="muted">· {{ index.building(o.recipe.building).name }}</span>
          <span v-if="o.recipe.disabledByDefault" class="tag">alt</span>
          <span v-if="rateNote(o.recipe)" class="nodata-tag" :title="rateNote(o.recipe)?.text">⚠︎</span>
          <span v-if="index.building(o.recipe.building).upgradeOf" class="tag">↑</span>
        </span>

        <span v-if="o.recipe.rateFrom === 'missing'" class="option-io muted">
          no cycle time data · {{ perCycleText(o.recipe, itemName) }}
        </span>
        <span v-else class="option-io">
          <template v-for="x in o.io.ins" :key="'i' + x.item.id">
            <ItemIcon standalone :item="x.item" :size="13" />{{ formatRate(x.rate) }}
          </template>
          <span v-if="!o.io.ins.length" class="muted">–</span>
          <span class="arrow">→</span>
          <template v-for="x in o.io.outs" :key="'o' + x.item.id">
            <ItemIcon standalone :item="x.item" :size="13" />{{ formatRate(x.rate) }}
          </template>
          <span class="muted">{{ RATE_UNIT_LABEL }}/machine</span>
        </span>

        <span class="option-meta">{{ formatQuantity(countFor(o.per), 'machine') }}</span>
      </button>
    </template>

    <!-- Transport -->
    <template v-if="transport.length">
      <div class="picker-group">Transport</div>
      <div class="special-row">
        <button
          v-for="t in transport"
          :key="t.key"
          type="button"
          class="chip"
          data-option
          @click="chooseTransport(t)"
        >
          {{ t.label }}
        </button>
      </div>
    </template>

    <p v-if="nothingFound" class="picker-note">No match for “{{ query }}”.</p>
    <p v-else-if="!words.length && !allRecipes.length && !allMiners.length" class="picker-note">
      {{ isInput ? 'This item has no recipe, and no mine gives it.' : 'No recipe uses this item.' }}
    </p>
  </div>
</template>

<script lang="ts" src="./PortPicker.ts"></script>
<style lang="scss" scoped src="./PortPicker.scss"></style>
