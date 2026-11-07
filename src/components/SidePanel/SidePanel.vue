<!--
  SidePanel – header (title, data status) and the overview sections (logic: SidePanel.ts).
-->
<template>
  <aside class="panel">
    <header class="panel-header">
      <h1>{{ gameData.title }}</h1>
      <p>
        {{ project.name }}<template v-if="gameData.subtitle"> · {{ gameData.subtitle }}</template>
      </p>

      <div class="data-status">
        <span>Data: <code>public/data/</code> · {{ loadedAtText }}</span>
        <button type="button" class="link-btn" title="Re-read the data files" @click="reloadData">
          Reload
        </button>
      </div>
    </header>

    <BaseList />
    <SummarySection />
    <NodesSection />
    <RailsSection />
    <MissingDataSection />
    <SettingsSection />
  </aside>
</template>

<script lang="ts" src="./SidePanel.ts"></script>
