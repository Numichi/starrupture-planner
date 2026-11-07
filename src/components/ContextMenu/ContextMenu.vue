<!--
  ContextMenu – right-click menu for the canvas (place, balance, arrange), a node, several
  selected nodes, or an edge (logic: ContextMenu.ts, styles: ContextMenu.scss).
-->
<template>
  <div class="menu-backdrop" @pointerdown="done" @contextmenu.prevent @wheel.prevent />

  <div class="menu" :style="menuStyle" role="menu" @pointerdown.stop @contextmenu.prevent>
    <!-- ===================== CANVAS ===================== -->
    <template v-if="menu.target.type === 'canvas'">
      <input
        ref="searchEl"
        v-model="query"
        class="menu-search"
        type="search"
        placeholder="What to place? (item, recipe, building)"
        aria-label="Search"
        @keydown.enter="onSearchEnter"
      />

      <!-- Search results -->
      <div v-if="results" class="menu-list">
        <div v-if="results.recipes.length" class="menu-group">Factory</div>
        <button
          v-for="r in results.recipes"
          :key="r.id"
          type="button"
          class="menu-item"
          @click="placeRecipe(r)"
        >
          <ItemIcon standalone :item="index.item(r.product)" :size="16" />
          <span class="menu-main">
            {{ r.name }} <span class="muted">· {{ index.building(r.building).name }}</span>
            <span v-if="rateNote(r)" class="nodata-tag" :title="rateNote(r)?.text">⚠︎</span>
            <span v-if="r.rateFrom === 'missing'" class="menu-io muted">no cycle time data</span>
            <span v-else class="menu-io">
              <template v-for="x in io(r).ins" :key="'i' + x.item.id">
                <ItemIcon standalone :item="x.item" :size="12" />{{ formatRate(x.rate) }}
              </template>
              <span v-if="!io(r).ins.length" class="muted">–</span> →
              <template v-for="x in io(r).outs" :key="'o' + x.item.id">
                <ItemIcon standalone :item="x.item" :size="12" />{{ formatRate(x.rate) }}
              </template>
              <span class="muted">{{ RATE_UNIT_LABEL }}/machine</span>
            </span>
          </span>
        </button>

        <div v-if="results.mines.length" class="menu-group">Mine</div>
        <button
          v-for="m in results.mines"
          :key="m.building.id + m.item"
          type="button"
          class="menu-item"
          @click="placeMine(m.building, m.item)"
        >
          <ItemIcon standalone :item="index.item(m.item)" :size="16" />
          <span class="menu-main"
            >{{ index.item(m.item).name }} <span class="muted">· {{ m.building.name }}</span></span
          >
        </button>

        <div v-if="results.specials.length" class="menu-group">Transport</div>
        <button
          v-for="s in results.specials"
          :key="s.kind"
          type="button"
          class="menu-item"
          @click="placeSpecial(s.kind)"
        >
          <span class="menu-main"
            >{{ s.label }} <span class="muted">· {{ s.hint }}</span></span
          >
        </button>

        <div
          v-if="!results.recipes.length && !results.mines.length && !results.specials.length"
          class="menu-empty"
        >
          No match.
        </div>
      </div>

      <!-- Browsing -->
      <div v-else class="menu-list">
        <template v-if="view.type === 'root'">
          <div class="menu-group">Place here</div>
          <button type="button" class="menu-item menu-item--more" @click="view = { type: 'factories' }">
            Factory (recipe) <span class="chev">›</span>
          </button>
          <button type="button" class="menu-item menu-item--more" @click="view = { type: 'mines' }">
            Mine <span class="chev">›</span>
          </button>
          <button
            v-for="s in SPECIALS"
            :key="s.kind"
            type="button"
            class="menu-item"
            @click="placeSpecial(s.kind)"
          >
            <span class="menu-main"
              >{{ s.label }} <span class="muted">· {{ s.hint }}</span></span
            >
          </button>
          <button
            type="button"
            class="menu-item menu-item--more"
            :disabled="!otherBases.length"
            @click="view = { type: 'railLink' }"
          >
            Inter-base rail
            <span class="muted">{{
              otherBases.length ? '· outgoing, to another base' : '· needs another base'
            }}</span>
            <span class="chev">›</span>
          </button>

          <div class="menu-sep" />

          <button type="button" class="menu-item" @click="balanceNodes()">
            Balance <span class="muted">· the machine counts of this base</span>
          </button>
          <button v-if="multiBase" type="button" class="menu-item" @click="balanceNodes(allProducers)">
            Balance <span class="muted">· the whole project (cargo and rails too)</span>
          </button>
          <button type="button" class="menu-item" @click="arrange()">
            Automatic layout <span class="muted">· the base</span>
          </button>
          <button type="button" class="menu-item" :disabled="!hasClipboard" @click="paste">
            Paste here <span class="muted">· Ctrl+V</span>
          </button>
          <button type="button" class="menu-item" @click="selectAll">
            Select all <span class="muted">· Ctrl+A</span>
          </button>
          <button type="button" class="menu-item" @click="fit">Fit view</button>
        </template>

        <template v-else-if="view.type === 'factories'">
          <button type="button" class="menu-back" @click="view = { type: 'root' }">‹ Back</button>
          <div class="menu-group">Building</div>
          <button
            v-for="b in productionBuildings"
            :key="b.id"
            type="button"
            class="menu-item menu-item--more"
            @click="view = { type: 'building', building: b }"
          >
            <img v-if="b.icon" :src="b.icon" alt="" class="menu-bicon" />
            <span class="menu-main"
              >{{ b.name }} <span class="muted">· {{ recipesOf(b).length }} recipes</span></span
            >
            <span class="chev">›</span>
          </button>
        </template>

        <template v-else-if="view.type === 'building'">
          <button type="button" class="menu-back" @click="view = { type: 'factories' }">
            ‹ {{ view.building.name }}
          </button>
          <button
            v-for="r in recipesOf(view.building)"
            :key="r.id"
            type="button"
            class="menu-item"
            @click="placeRecipe(r)"
          >
            <ItemIcon standalone :item="index.item(r.product)" :size="16" />
            <span class="menu-main">
              {{ r.name }}
              <span v-if="rateNote(r)" class="nodata-tag" :title="rateNote(r)?.text">⚠︎</span>
              <span v-if="r.rateFrom === 'missing'" class="menu-io muted">no cycle time data</span>
              <span v-else class="menu-io">
                <template v-for="x in io(r).ins" :key="'i' + x.item.id">
                  <ItemIcon standalone :item="x.item" :size="12" />{{ formatRate(x.rate) }}
                </template>
                →
                <template v-for="x in io(r).outs" :key="'o' + x.item.id">
                  <ItemIcon standalone :item="x.item" :size="12" />{{ formatRate(x.rate) }}
                </template>
              </span>
            </span>
          </button>
        </template>

        <template v-else-if="view.type === 'mines'">
          <button type="button" class="menu-back" @click="view = { type: 'root' }">‹ Back</button>
          <button
            v-for="m in mineOptions"
            :key="m.building.id + m.item"
            type="button"
            class="menu-item"
            @click="placeMine(m.building, m.item)"
          >
            <ItemIcon standalone :item="index.item(m.item)" :size="16" />
            <span class="menu-main"
              >{{ index.item(m.item).name }} <span class="muted">· {{ m.building.name }}</span></span
            >
          </button>
        </template>

        <template v-else-if="view.type === 'railLink'">
          <button type="button" class="menu-back" @click="view = { type: 'root' }">
            ‹ Inter-base rail to:
          </button>
          <button
            v-for="b in otherBases"
            :key="b.id"
            type="button"
            class="menu-item"
            @click="placeRailLink(b.id)"
          >
            → {{ b.name }}
          </button>
        </template>
      </div>
    </template>

    <!-- ===================== SEVERAL SELECTED ===================== -->
    <div v-else-if="multi" class="menu-list">
      <div class="menu-group">{{ multi.length }} selected nodes</div>
      <button type="button" class="menu-item" @click="balanceNodes(multi)">
        Balance <span class="muted">· the machine counts of the selection</span>
      </button>
      <button type="button" class="menu-item" @click="arrange(multi)">
        Automatic layout <span class="muted">· the selection</span>
      </button>
      <button type="button" class="menu-item" @click="copy(multi)">
        Copy <span class="muted">· Ctrl+C, with the links between them</span>
      </button>
      <div class="menu-sep" />
      <button type="button" class="menu-item menu-item--danger" @click="removeSelected(multi)">
        Delete ({{ multi.length }})
      </button>
    </div>

    <!-- ===================== NODE ===================== -->
    <div v-else-if="node" class="menu-list">
      <div class="menu-group">{{ nodeKindLabel }}: {{ node.title }}</div>
      <button type="button" class="menu-item" @click="edit">Edit</button>

      <template v-if="canUpgrade">
        <div class="menu-group">Upgrade</div>
        <button v-if="noUpgradeNote" type="button" class="menu-item" disabled>
          ↑ Upgrade <span class="muted">· {{ noUpgradeNote }}</span>
        </button>
        <button
          v-for="o in upgrades"
          :key="o.building.id + (o.recipe?.id ?? '')"
          type="button"
          class="menu-item"
          @click="doUpgrade(o)"
        >
          <span class="menu-main">
            {{ o.direction === 'up' ? '↑' : '↓' }} {{ o.building.name }}
            <span v-if="o.recipe" class="muted">· {{ o.recipe.name }}</span>
            <span v-if="o.recipe" class="menu-io">
              <template v-for="x in io(o.recipe).ins" :key="'i' + x.item.id">
                <ItemIcon standalone :item="x.item" :size="12" />{{ formatRate(x.rate) }}
              </template>
              →
              <template v-for="x in io(o.recipe).outs" :key="'o' + x.item.id">
                <ItemIcon standalone :item="x.item" :size="12" />{{ formatRate(x.rate) }}
              </template>
              <span class="muted">/machine</span>
            </span>
          </span>
        </button>
      </template>

      <div class="menu-sep" />

      <button
        v-if="node.kind === 'factory'"
        type="button"
        class="menu-item"
        :disabled="!shortInputs"
        @click="chain"
      >
        Build chain <span class="muted">· for the missing inputs, down to the raw materials</span>
      </button>
      <button
        v-if="node.kind === 'factory' || node.kind === 'mine'"
        type="button"
        class="menu-item"
        @click="balanceNodes([node.id], true)"
      >
        Balance machine count <span class="muted">· to the linked demand{{ balanceNote }}</span>
      </button>
      <button v-if="node.kind === 'factory'" type="button" class="menu-item" @click="toggleCountMode(node)">
        {{ node.countMode === 'manual' ? 'Automatic machine count' : 'Manual machine count' }}
        <span class="muted">
          ·
          {{
            node.countMode === 'manual'
              ? 'from the material reaching the inputs'
              : `with the current ${formatQuantity(node.count, 'machine')}`
          }}
        </span>
      </button>
      <button
        v-if="node.kind !== 'railIn' && node.kind !== 'railOut'"
        type="button"
        class="menu-item"
        @click="copy([node.id])"
      >
        Copy <span class="muted">· Ctrl+C</span>
      </button>
      <button type="button" class="menu-item" :disabled="!hasLinks" @click="removeLinksOfNode">
        Delete links
      </button>
      <button
        v-if="canDelete"
        type="button"
        class="menu-item menu-item--danger"
        @click="removeSelected([node.id])"
      >
        Delete <span class="muted">· Delete</span>
      </button>
    </div>

    <!-- ===================== EDGE ===================== -->
    <div v-else-if="link" class="menu-list">
      <div class="menu-group">
        {{ railLinks.length > 1 ? 'Rail:' : 'Link:' }}
        <template v-for="x in railLinks" :key="x.id"
          ><ItemIcon standalone :item="index.item(x.item)" :size="13" />
        </template>
        {{ railLinks.length > 1 ? `${railLinks.length} items` : index.item(link.item).name }}
      </div>
      <div class="menu-note">{{ nodeTitle(link.from) }} → {{ nodeTitle(link.to) }}</div>
      <button type="button" class="menu-item" @click="openLink">
        Details <span class="muted">· items, rails, distribution, manual rail</span>
      </button>
      <button type="button" class="menu-item" @click="selectEnds">Select both ends</button>
      <button type="button" class="menu-item menu-item--danger" @click="removeLink">
        {{ railLinks.length > 1 ? 'Delete rail (all its items)' : 'Delete link' }}
        <span class="muted">· Delete</span>
      </button>
    </div>

    <div v-else class="menu-empty">This element no longer exists.</div>
  </div>
</template>

<script lang="ts" src="./ContextMenu.ts"></script>
<style lang="scss" scoped src="./ContextMenu.scss"></style>
