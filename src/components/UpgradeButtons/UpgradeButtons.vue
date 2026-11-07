<!--
  UpgradeButtons – "↑ upgrade" / "↓ downgrade" buttons of a factory or mine (logic: UpgradeButtons.ts).
-->
<template>
  <div class="upgrade">
    <div class="btn-row">
      <button
        v-for="o in ups"
        :key="o.building.id + (o.recipe?.id ?? '')"
        type="button"
        class="link-btn"
        :title="o.recipe ? `${o.building.name}: ${o.recipe.name}` : o.building.name"
        @click="choose(o)"
      >
        ↑ {{ o.building.name
        }}<span v-if="o.recipe && ups.length > 1" class="muted"> · {{ o.recipe.name }}</span>
      </button>

      <button v-if="!ups.length" type="button" class="link-btn" disabled :title="note">↑ Upgrade</button>

      <button
        v-for="o in downs"
        :key="'d' + o.building.id + (o.recipe?.id ?? '')"
        type="button"
        class="link-btn"
        :title="`Back to: ${o.building.name}`"
        @click="choose(o)"
      >
        ↓ {{ o.building.name }}
      </button>
    </div>

    <p v-if="note" class="hint">{{ note }}</p>
  </div>
</template>

<script lang="ts" src="./UpgradeButtons.ts"></script>
