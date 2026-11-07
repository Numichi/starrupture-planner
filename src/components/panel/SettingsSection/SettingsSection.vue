<!--
  SettingsSection – display, chain builder, game rules, recipes, data file errors (logic: SettingsSection.ts).
-->
<template>
  <!-- ========== DISPLAY ========== -->
  <section>
    <h2>Display</h2>

    <div class="field-label">Lines</div>
    <div class="segmented" role="radiogroup" aria-label="Line style">
      <button
        v-for="s in LINE_STYLES"
        :key="s.value"
        type="button"
        role="radio"
        :aria-checked="display.lineStyle === s.value"
        :class="{ active: display.lineStyle === s.value }"
        @click="display.lineStyle = s.value"
      >
        {{ s.label }}
      </button>
    </div>

    <label class="check"><input v-model="display.coloredEdges" type="checkbox" /> Coloured lines</label>
    <label class="check">
      <input v-model="display.proportionalWidth" type="checkbox" /> Width proportional to the flow
    </label>
    <label class="check"
      ><input v-model="display.showRails" type="checkbox" /> Rail tier on the line labels</label
    >
    <label class="check"
      ><input v-model="display.snapToGrid" type="checkbox" /> Snap to grid while dragging</label
    >

    <div class="field-label layout-title">Automatic layout</div>
    <label class="slider">
      <span
        >Column spacing <em>{{ display.layerSpacing }} px</em></span
      >
      <input v-model.number="display.layerSpacing" type="range" min="50" max="260" step="10" />
    </label>
    <label class="slider">
      <span
        >Row spacing <em>{{ display.nodeSpacing }} px</em></span
      >
      <input v-model.number="display.nodeSpacing" type="range" min="12" max="120" step="4" />
    </label>
  </section>

  <!-- ========== OPTIMISATION ========== -->
  <section>
    <h2>Build chain</h2>

    <label class="check"
      ><input v-model="settings.objective" type="radio" value="buildings" /> Fewest buildings</label
    >
    <label class="check"
      ><input v-model="settings.objective" type="radio" value="power" /> Lowest power demand</label
    >

    <p class="hint">
      When several enabled recipes make an item, this decides. The chain is built with base buildings; the
      upgraded (v.2) variant is chosen per node.
    </p>
  </section>

  <!-- ========== GAME RULES (game.yml features, display only) ========== -->
  <section>
    <h2>Game rules</h2>

    <div class="rule-row">
      <span>Cargo pairing</span>
      <strong>{{ cargoRules.manyToOne ? 'N:1 (several Dispatchers)' : '1:1 (override)' }}</strong>
    </div>
    <div class="rule-row" :title="distributionHint">
      <span>Distribution</span>
      <strong>{{ flowOptions.distribution === 'even' ? 'even (no priority)' : 'optimal' }}</strong>
    </div>

    <p class="hint">
      Switchable in the <code>features:</code> part of game.yml when a patch changes it
      (<code>cargoManyToOne</code>, <code>flowDistribution</code>: <code>even</code> / <code>optimal</code>).
    </p>
  </section>

  <!-- ========== RECIPES ========== -->
  <section>
    <details>
      <summary>
        <h2>
          Recipes for the chain
          <span class="muted">({{ enabledRecipeCount }}/{{ recipeGroups.length }})</span>
        </h2>
      </summary>

      <p class="hint">
        "Build chain" only picks from the enabled recipes. Any of them can be placed manually.
      </p>

      <label v-for="g in recipeGroups" :key="g.id" class="recipe">
        <input type="checkbox" :checked="isRecipeEnabled(g.recipe)" @change="toggleRecipe(g.recipe)" />
        <span class="recipe-body">
          <span class="recipe-name">
            {{ g.recipe.name }}
            <span v-if="g.recipe.disabledByDefault" class="tag">alt</span>
            <span
              v-if="g.recipe.rateFrom === 'missing'"
              class="nodata-tag"
              title="No cycle time data: the chain does not use it until one is entered (Missing data)"
            >
              ⚠︎
            </span>
          </span>

          <span v-if="g.recipe.rateFrom === 'missing'" class="muted recipe-io"
            >no cycle time data (Missing data)</span
          >

          <!-- Per-machine /min values in the base building (data file value × building speed) -->
          <span v-else class="recipe-io">
            <span v-for="io in g.recipe.inputs" :key="'i' + io.item" class="io-amount">
              <ItemIcon standalone :item="index.item(io.item)" :size="15" />{{
                formatRate(perMinute(g.recipe, io.amount))
              }}
            </span>
            <span class="arrow">→</span>
            <span v-for="io in g.recipe.outputs" :key="'o' + io.item" class="io-amount">
              <ItemIcon standalone :item="index.item(io.item)" :size="15" />{{
                formatRate(perMinute(g.recipe, io.amount))
              }}
            </span>
            <span class="muted io-unit">{{ RATE_UNIT_LABEL }}/machine</span>
          </span>

          <span class="muted recipe-building">{{ g.buildings.map((b) => b.name).join(' / ') }}</span>
        </span>
      </label>
    </details>
  </section>

  <!-- ========== DATA ERRORS ========== -->
  <section v-if="loadError || dataWarnings.length">
    <div v-if="loadError" class="callout callout--error load-error">
      <strong>The data file cannot be read</strong>
      <div class="io-line">{{ loadError }}</div>
    </div>

    <div v-if="dataWarnings.length" class="callout callout--warn">
      <strong>Warnings in the data files ({{ dataWarnings.length }})</strong>
      <div v-for="w in dataWarnings" :key="w" class="io-line warning-line">{{ w }}</div>
    </div>
  </section>
</template>

<script lang="ts" src="./SettingsSection.ts"></script>
<style lang="scss" scoped src="./SettingsSection.scss"></style>
