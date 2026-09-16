<!-- Tab.svelte -->
<script>
  import { createEventDispatcher } from "svelte";

  export let tab;
  export let active = false;
  const dispatch = createEventDispatcher();

  function handleClick() {
    dispatch("tabclick", tab.id);
  }
</script>

<div class={`tab-container ${active ? "active" : ""}`}>
  <button on:click={handleClick} class="tab-button">
    <p class="tab-button-txt">
      {tab.title}
    </p>
  </button>
</div>

<style>
  .tab-button-txt {
    font-weight: 600;
    font-size: 20px;
    letter-spacing: 0.3px;
    text-shadow: 1px 1px 2px rgba(0, 0, 0, 0.8);
    color: white;
  }

  .tab-container {
    background: rgba(255, 255, 255, 0.1);
    border: 1px solid rgba(255, 255, 255, 0.3);
    backdrop-filter: blur(10px);
    border-radius: 15px;
    color: white;
    padding: 0;
    width: 250px;
    height: 250px;
    display: flex;
    justify-content: center;
    align-items: center;
    transition: background 0.3s ease;
    user-select: none;
    cursor: pointer;
    overflow: hidden;
  }

  .tab-button {
    background: none;
    border: none;
    color: white;
    font-size: 1em;
    cursor: pointer;
    position: relative;
    display: block;
    width: 100%;
    height: 100%;
    top: 0;
    left: 0;
    margin: 0;
  }

  .tab-container:hover {
    background: rgba(255, 255, 255, 0.2);
  }

  .tab-container.active {
    background: rgba(255, 255, 255, 0.3);
  }
</style>
