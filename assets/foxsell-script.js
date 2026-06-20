// @ts-nocheck

/** @typedef {import('./types').BundleItem} BundleItem */
/** @typedef {import('./types').BundlePriceStrategy} BundlePriceStrategy */
/** @typedef {import('./types').AddOnLimits} AddOnLimits */
/** @typedef {import('./types').BundleState} BundleState */

const newDate = new Date();
window.currentTime = newDate.getTime();
if (window.oldTime) {
  setTimeout(() => {
    window.location.reload();
  }, 100);
}
window.oldTime = window.currentTime;

/**
 * Bundle state management singleton
 * Handles global state for the bundle builder
 * @type {Object}
 */
const BundleStateManager = {
  /**
   * Initialize the bundle state
   * @returns {void}
   */
  initBundleState() {
    // Initialize the bundle state if it doesn't exist
    if (!window.fsBundleState) {
      /**
       * @type {import('./types').BundleState}
       */
      window.fsBundleState = {
        bundleItems: {},
        addOnItems: {},
        currentQuantity: 0,
        bundleQuantity: 0,
        addOnQuantity: 0,
        addOnLimits: { minimum: 0, maximum: 0 },
        priceStrategy: { strategy: "fixed_pricing", value: 0 },
        selectedOption: null,
        totalPrice: 0,
        originalPrice: null,
        discountedPrice: null,
        subscribers: new Map(),
        autoUpgradeEnabled: fsbAdditionalSettings.auto_advance_bundle || true,
        cachedBundleOptions: null,
        bundleOptionsElement: document.querySelector("fsb-bundleoptions"),
        allProductsHaveSingleVariant: false,
        productVariantCounts: new Map(),

        /**
         * Updates multiple state properties at once
         * @param {Object} settings - Settings object
         * @param {number} [settings.bundleQuantity] - Bundle quantity
         * @param {AddOnLimits} [settings.addOnLimits] - Add-on limits
         * @param {BundlePriceStrategy} [settings.priceStrategy] - Price strategy
         * @param {string} [settings.selectedOption] - Selected option ID
         */
        setInitialState(settings = {}) {
          if (settings.bundleQuantity !== undefined) {
            this.bundleQuantity = settings.bundleQuantity;
          }
          if (settings.addOnLimits) {
            this.addOnLimits = settings.addOnLimits;
          }
          if (settings.priceStrategy) {
            this.priceStrategy = settings.priceStrategy;
          }
          if (settings.selectedOption) {
            this.selectedOption = settings.selectedOption;
          }
          this.cacheBundleOptions();
          try {
            this.notifySubscribers("stateInitialized");
          } catch (e) {
            console.error("Error notifying subscribers:", e);
          }
        },

        /**
         * Caches bundle options to avoid repeated DOM queries
         */
        cacheBundleOptions() {
          this.cachedBundleOptions = Array.from(
            document.querySelectorAll(".bundle-option")
          )
            .map((option) => ({
              element: option,
              quantity: parseInt(option.getAttribute("data-quantity"), 10),
              id: option.getAttribute("data-option-id"),
              settings: JSON.parse(option.dataset.option || "{}"),
            }))
            .reduce((uniqueOptions, option) => {
              if (
                !uniqueOptions.some(
                  (uniqueOption) => uniqueOption.id === option.id
                )
              ) {
                uniqueOptions.push(option);
              }
              return uniqueOptions;
            }, [])
            .sort((a, b) => a.quantity - b.quantity);
        },

        /**
         * Finds the best fitting bundle for the current quantity
         * @returns {Object|null} Best fitting bundle option
         */
        findOptimalBundle() {
          if (!this.cachedBundleOptions) {
            this.cacheBundleOptions();
          }

          // Find the smallest bundle that can fit current quantity
          return this.cachedBundleOptions.find(
            (option) => option.quantity >= this.currentQuantity
          );
        },

        /**
         * Finds the next larger bundle than current
         * @returns {Object|null} Next larger bundle or null
         */
        findNextBundle() {
          if (!this.cachedBundleOptions) {
            this.cacheBundleOptions();
          }
          return this.cachedBundleOptions.find(
            (option) => option.quantity > this.bundleQuantity
          );
        },

        /**
         * Tracks variant counts for a product
         * @param {string|number} productId - Product identifier
         * @param {number} variantCount - Number of available variants
         */
        trackProductVariants(productId, variantCount) {
          this.productVariantCounts.set(productId.toString(), variantCount);
        },

        /**
         * Checks if all products have only single variants
         * @returns {boolean} True if all products have single variants
         */
        checkAllProductsHaveSingleVariant() {
          // If no products tracked yet, default to false
          if (this.productVariantCounts.size === 0) {
            this.allProductsHaveSingleVariant = false;
            return false;
          }

          // Check each product's variant count
          for (const variantCount of this.productVariantCounts.values()) {
            // If any product has more than 1 variant, not all products have single variants
            if (variantCount > 1) {
              this.allProductsHaveSingleVariant = false;
              return false;
            }
          }

          // All products have single variants
          this.allProductsHaveSingleVariant = true;
          return true;
        },

        /**
         * Adds an item to the bundle with auto-sizing
         * @param {string} itemKey - Item identifier
         * @param {import('./types').BundleItem} itemData - Item data
         * @returns {boolean} Success status
         */
        addBundleItem(itemKey, itemData) {
          // Check if we need to auto-upgrade
          if (
            this.currentQuantity >= this.bundleQuantity &&
            this.autoUpgradeEnabled
          ) {
            const nextBundle = this.findNextBundle();
            if (nextBundle && this.selectedOption !== nextBundle.id) {
              this.autoSwitchBundle(nextBundle);
              // After upgrade, check if we can add the item
              if (this.currentQuantity >= this.bundleQuantity) {
                return false;
              }
            } else {
              return false;
            }
          }

          // Add the item
          if (this.bundleItems[itemKey]) {
            this.bundleItems[itemKey].quantity++;
          } else {
            this.bundleItems[itemKey] = {
              ...itemData,
              quantity: 1,
              addedAt: Date.now(),
            };
          }
          this.currentQuantity++;
          if (window.fsbSettings && window.fsbSettings.added_toast_message) {
            Fsb.showToast(window.fsbSettings.added_toast_message);
          }
          this.notifySubscribers("bundleItems");
          return true;
        },

        /**
         * Switches bundle size with UI updates
         * @param {import('./types').BundleOption} bundleOption - Target bundle option
         */
        autoSwitchBundle(bundleOption) {
          // Update state as before...
          this.setInitialState({
            bundleQuantity: bundleOption.quantity,
            selectedOption: bundleOption.id,
            addOnLimits: bundleOption.settings.add_on || {
              minimum: 0,
              maximum: 0,
            },
            priceStrategy: bundleOption.settings.price || {
              strategy: "fixed_pricing",
              value: 0,
            },
          });

          // Use cached bundle options component and popover
          if (this.bundleOptionsElement) {
            this.bundleOptionsElement.updateBundleDetails(bundleOption.id);
            this.bundleOptionsElement.updateSelectedAttr(bundleOption.element);
            this.bundleOptionsElement.updatePriceVisibility(
              bundleOption.settings.price?.strategy
            );
            if (this.popoverEl) {
              this.bundleOptionsElement.updatePopoverText(bundleOption);
            }
          }

          // Create and show notification (could also be debounced/reused)
          const direction =
            bundleOption.quantity > this.bundleQuantity
              ? "increased"
              : "decreased";
          const notification = document.createElement("div");
          notification.className =
            "fsb__notification fsb__notification--resize";
          notification.textContent = `Bundle size ${direction} to ${bundleOption.quantity} items`;
          document.querySelector(".fsb-wrapper")?.appendChild(notification);
          setTimeout(() => notification.remove(), 3000);

          // Dispatch event as before
          const bundleOptionChangeEvent = new CustomEvent(
            "bundleOptionChange",
            {
              detail: {
                addOnLimits: this.addOnLimits,
                bundleQuantity: this.bundleQuantity,
                selectedOptionId: bundleOption.id,
                priceStrategy: this.priceStrategy,
                isAutomatic: true,
              },
              bubbles: true,
              composed: true,
            }
          );
          document.dispatchEvent(bundleOptionChangeEvent);
        },

        /**
         * Removes a bundle item and handles auto-downsizing
         * @param {string} itemKey - Item identifier
         */
        removeBundleItem(itemKey) {
          if (!this.bundleItems[itemKey]) return;

          // Remove the item
          this.bundleItems[itemKey].quantity--;
          if (this.bundleItems[itemKey].quantity === 0) {
            delete this.bundleItems[itemKey];
          }
          this.currentQuantity--;

          // Auto-adjust bundle size if enabled
          if (this.autoUpgradeEnabled && this.currentQuantity > 0) {
            const optimalBundle = this.findOptimalBundle();
            if (optimalBundle && optimalBundle.id !== this.selectedOption) {
              this.autoSwitchBundle(optimalBundle);
            }
          }

          this.notifySubscribers("bundleItems");
        },

        /**
         * Adds an add-on item to the bundle
         * @param {string} variantId - Variant ID
         * @param {import('./types').AddOnItem} itemData - Item data
         * @returns {string} Generated unique key for the item
         */
        addAddonItem(variantId, itemData) {
          const uniqueKey = `${variantId}_${Date.now()}`;
          this.addOnItems[uniqueKey] = {
            ...itemData,
            variantId, // Store the original variantId
            quantity: 1,
          };
          this.addOnQuantity++;
          if (window.fsbSettings && window.fsbSettings.added_toast_message) {
            Fsb.showToast(window.fsbSettings.added_toast_message);
          }
          this.notifySubscribers("addOnItems");
          return uniqueKey; // Return the generated key
        },

        /**
         * Removes an add-on item from the bundle
         * @param {string} itemKey - Item identifier
         */
        removeAddonItem(itemKey) {
          if (this.addOnItems[itemKey]) {
            delete this.addOnItems[itemKey];
            this.addOnQuantity--;
            this.notifySubscribers("addOnItems");
          }
        },

        /**
         * Notifies subscribers of state changes
         * @param {string} changeType - Type of change
         */
        notifySubscribers(changeType) {
          for (const [component, callback] of this.subscribers) {
            if (typeof callback === "function") {
              try {
                callback.call(component, changeType);
              } catch (e) {
                console.error("Error calling subscriber callback:", e);
              }
            }
          }
        },

        /**
         * Subscribes a component to state changes
         * @param {Object} component - Component to subscribe
         * @param {function(string):void} callback - Callback function
         */
        subscribe(component, callback) {
          if (typeof callback === "function") {
            this.subscribers.set(component, callback);
          }
        },

        /**
         * Unsubscribes a component from state changes
         * @param {Object} component - Component to unsubscribe
         */
        unsubscribe(component) {
          this.subscribers.delete(component);
        },
      };
    }
    // Store reference to the global state
    this.bundleState = window.fsBundleState;
  },
};

var Fsb = Fsb || {};

// ---------------------------------------------------------------------------
// Money format handler
Fsb.formatMoney = (cents, format = fsMoneyFormat) => {
  if (typeof cents === "string") {
    cents = cents.replace(".", "");
  }
  const currencyRate = window.Shopify?.currency?.rate ?? 1;
  cents *= currencyRate;
  const placeholderRegex = /\{\{\s*(\w+)\s*\}\}/;
  const formatWithDelimiters = (
    number,
    precision = 2,
    thousands = ",",
    decimal = "."
  ) => {
    if (isNaN(number) || number == null) {
      return 0;
    }
    number = (number / 100).toFixed(precision);
    const [dollars, cents] = number.split(".");
    const dollarsAmount = dollars.replace(
      /(\d)(?=(\d{3})+(?!\d))/g,
      `$1${thousands}`
    );
    const centsAmount = cents ? `${decimal}${cents}` : "";
    return dollarsAmount + centsAmount;
  };
  let value = "";
  const formatKey = format.match(placeholderRegex)?.[1];
  switch (formatKey) {
    case "amount":
      value = formatWithDelimiters(cents, 2);
      break;
    case "amount_no_decimals":
      value = formatWithDelimiters(cents, 0);
      break;
    case "amount_with_space_separator":
      value = formatWithDelimiters(cents, 2, " ", ".");
      break;
    case "amount_with_comma_separator":
      value = formatWithDelimiters(cents, 2, ".", ",");
      break;
    case "amount_with_apostrophe_separator":
      value = formatWithDelimiters(cents, 2, "'", ".");
      break;
    case "amount_no_decimals_with_comma_separator":
      value = formatWithDelimiters(cents, 0, ".", ",");
      break;
    case "amount_no_decimals_with_space_separator":
      value = formatWithDelimiters(cents, 0, " ");
      break;
    case "amount_no_decimals_with_apostrophe_separator":
      value = formatWithDelimiters(cents, 0, "'");
      break;
  }
  return format.replace(placeholderRegex, value);
};

Fsb.showToast = (message) => {
  // Remove any existing toast
  let toast = document.querySelector(".fsb__toast");
  if (!toast) {
    toast = document.createElement("div");
    toast.className = "fsb__toast";
    toast.setAttribute("role", "status");
    toast.setAttribute("aria-live", "polite");
    document.body.appendChild(toast);
  }
  toast.textContent = message;
  toast.classList.add("fsb__toast--visible");

  // Remove after 2.5s
  clearTimeout(Fsb._toastTimeout);
  Fsb._toastTimeout = setTimeout(() => {
    toast.classList.remove("fsb__toast--visible");
  }, 2500);
};

window.Fsb = Fsb;

/**
 * Bundle options component
 * @customElement
 * @extends HTMLElement
 */
class FsbBundleOptions extends HTMLElement {
  /**
   * Constructor
   */
  constructor() {
    super();
    this.initializeProperties();
  }

  /**
   * Called when element is connected to the DOM
   */
  connectedCallback() {
    this.initializeElements();
    this.initializeBundleState();
    this.initializePopover();
    this.addEventListeners();
  }

  /**
   * Initialize component properties
   */
  initializeProperties() {
    /**
     * @type {import('./types').BundleState}
     */
    this.bundleState = null;
  }

  initializeElements() {
    this.bundleOptions = Array.from(this.querySelectorAll(".bundle-option"));
    this.selectedBundleOption = this.querySelector(".bundle-option[selected]");
    this.popoverEl = this.querySelector("fsb-popover");
    this.aside = this.closest("fsb-aside");
    BundleStateManager.initBundleState.call(this);
    this.bundleState.subscribe(this, this.handleStateChange);
  }

  initializePopover() {
    const popover = this.querySelector("fsb-popover");
    if (popover) {
      const trigger = popover.querySelector(".fsb__popover-trigger");
      if (trigger && this.selectedBundleOption) {
        trigger.innerHTML = this.selectedBundleOption.innerHTML;
      }
    }
  }

  addEventListeners() {
    this.bundleOptions.forEach((bundleOption) => {
      bundleOption.addEventListener("click", (event) => {
        this.handleBundleOptionChange(bundleOption);
        const popover = this.querySelector("fsb-popover");
        if (popover) {
          popover.close();
          event.stopPropagation(); // Prevent the popover from reopening
        }
      });
    });
  }

  handleStateChange(changeType) {
    if (changeType === "stateInitialized") {
      // Find the currently selected bundle option based on state
      const selectedId = this.bundleState.selectedOption;
      if (selectedId) {
        const newSelectedOption = this.querySelector(
          `.bundle-option[data-option-id="${selectedId}"]`
        );
        if (newSelectedOption && !newSelectedOption.hasAttribute("selected")) {
          this.updatePopoverText(newSelectedOption);
          this.updateSelectedAttr(newSelectedOption);
        }
      }
    }
  }

  initializeBundleState() {
    if (this.selectedBundleOption) {
      const bundleVariantId =
        this.selectedBundleOption.getAttribute("data-option-id");
      const optionSettings = JSON.parse(
        this.selectedBundleOption.dataset.option || "{}"
      );
      this.bundleState.setInitialState({
        bundleQuantity:
          parseInt(
            this.selectedBundleOption.getAttribute("data-quantity"),
            10
          ) || 0,
        selectedOption: bundleVariantId,
        addOnLimits: optionSettings.add_on || { minimum: 0, maximum: 0 },
        priceStrategy: optionSettings.price || {
          strategy: "fixed_pricing",
          value: 0,
        },
      });
      // Update UI to reflect initial state
      this.updateBundleDetails(bundleVariantId);
      this.updateSelectedAttr(this.selectedBundleOption);
      this.updatePriceVisibility(this.bundleState.priceStrategy.strategy);
    }
  }

  updateBundleState(bundleOption) {
    const bundleVariantId = bundleOption.getAttribute("data-option-id");
    this.updateWindowUrl(bundleVariantId);
    this.updateBundleDetails(bundleVariantId);
    this.updateSelectedAttr(bundleOption);
    this.updatePopoverText(bundleOption);
    this.bundleQuantity =
      parseInt(bundleOption.getAttribute("data-quantity"), 10) || 0;
    const optionSettings = JSON.parse(bundleOption.dataset.option || "{}");
    const newAddOnLimits = optionSettings.add_on || { minimum: 0, maximum: 0 };
    const newPriceStrategy = optionSettings.price || {
      strategy: "fixed_pricing",
      value: 0,
    };
    this.updatePriceVisibility(newPriceStrategy.strategy);
    return { newAddOnLimits, newPriceStrategy, bundleVariantId };
  }

  handleBundleOptionChange(bundleOption) {
    const bundleVariantId = bundleOption.getAttribute("data-option-id");
    const optionSettings = JSON.parse(bundleOption.dataset.option || "{}");
    this.bundleState.setInitialState({
      bundleQuantity:
        parseInt(bundleOption.getAttribute("data-quantity"), 10) || 0,
      selectedOption: bundleVariantId,
      addOnLimits: optionSettings.add_on || { minimum: 0, maximum: 0 },
      priceStrategy: optionSettings.price || {
        strategy: "fixed_pricing",
        value: 0,
      },
    });
    this.updatePopoverText(bundleOption);
    this.updateBundleDetails(bundleVariantId);
    this.updateSelectedAttr(bundleOption);
    const bundleOptionChangeEvent = new CustomEvent("bundleOptionChange", {
      detail: {
        addOnLimits: this.bundleState.addOnLimits,
        bundleQuantity: this.bundleState.bundleQuantity,
        selectedOptionId: bundleVariantId,
        priceStrategy: this.bundleState.priceStrategy,
      },
      bubbles: true,
      composed: true,
    });
    this.dispatchEvent(bundleOptionChangeEvent);
  }

  updatePopoverText(bundleOption) {
    const popover = this.querySelector("fsb-popover");
    if (!popover) return;

    const trigger = popover.querySelector(".fsb__popover-trigger");
    if (!trigger) return;

    // If the option has HTML content, use it directly
    if (bundleOption.innerHTML.trim()) {
      trigger.innerHTML = bundleOption.innerHTML;
    } else {
      // Fallback to textContent if no HTML
      trigger.textContent = bundleOption.textContent;
    }

    // Force repaint to ensure UI update
    trigger.style.display = "none";
    trigger.offsetHeight;
    trigger.style.display = "";
  }

  updatePriceVisibility(priceStrategy) {
    const tabsContainer = document.querySelector(".fsb__tabs-container");
    if (tabsContainer) {
      if (priceStrategy === "fixed_pricing") {
        tabsContainer.classList.add("fsb__price-hidden");
      } else {
        tabsContainer.classList.remove("fsb__price-hidden");
      }
    }
  }

  updateWindowUrl(variantId) {
    const url = new URL(window.location.href);
    variantId
      ? url.searchParams.set("variant", variantId)
      : url.searchParams.delete("variant");
    window.history.replaceState({}, "", url.toString());
  }

  updateBundleDetails(bundleVariantId) {
    if (!this.aside) return;
    this.aside
      .querySelectorAll(".bundle-details, .bundle__additional-info")
      .forEach((option) => {
        option.classList.add("hidden");
      });
    this.aside
      .querySelectorAll(
        `.bundle-details[data-option-id="${bundleVariantId}"],.bundle__additional-info[data-option-id="${bundleVariantId}"]`
      )
      .forEach((activeOption) => {
        activeOption.classList.remove("hidden");
      });
  }

  updateSelectedAttr(bundleOption) {
    this.bundleOptions.forEach((bundle) => {
      bundle.removeAttribute("selected");
    });
    bundleOption.setAttribute("selected", "selected");
  }

  removeExcessItems() {
    while (this.bundleState.currentQuantity > this.bundleState.bundleQuantity) {
      const variantId = [...this.aside.bundleItems].pop();
      if (variantId) {
        const variantRemovedEvent = new CustomEvent(
          "variantRemovedFromBundle",
          {
            detail: { variantId },
            bubbles: true,
            composed: true,
          }
        );
        document.dispatchEvent(variantRemovedEvent);
      }
    }
  }
}

customElements.define("fsb-bundleoptions", FsbBundleOptions);

/**
 * Product variant selector component
 * Handles variant selection and option combinations
 */
class FsVariantSelector extends HTMLElement {
  constructor() {
    super();
    this.currentVariant = {};
    this.variants = [];
    this.handleChange = this.handleChange.bind(this);
  }

  connectedCallback() {
    this.variants = this.getJSONFromScript("data-all-variants") || [];
    this.initializeProperties();
    this.addEventListener("change", this.handleChange);
  }

  disconnectedCallback() {
    this.removeEventListener("change", this.handleChange);
  }

  initializeProperties() {
    this.currentVariant = this.getVariantData();
    this.selectInitialVariant();
    this.updateOptionVisibility();
  }

  getJSONFromScript(dataAttribute) {
    try {
      const script = this.querySelector(`script[${dataAttribute}]`);
      if (!script) {
        console.warn(`No script element found with ${dataAttribute}`);
        return null;
      }

      const content = script.textContent.trim();

      if (!content || content === "[]" || content === "[        ]") {
        return [];
      }

      if (typeof content === "object") {
        return content;
      }

      const cleanedContent = content.replace(/,(\s*[\]}])/g, "$1");

      try {
        const parsed = JSON.parse(cleanedContent);

        if (Array.isArray(parsed)) {
          return parsed.filter((item) => item && typeof item === "object");
        } else if (typeof parsed === "object") {
          return parsed;
        }

        console.warn("Parsed content has unexpected format");
        return null;
      } catch (parseError) {
        throw parseError;
      }
    } catch (error) {
      console.error("Error parsing variant data:", error);

      try {
        const script = this.querySelector(`script[${dataAttribute}]`);
        if (!script) return null;

        const content = script.textContent
          .replace(/^\uFEFF/, "")
          .replace(/\s+/g, " ")
          .trim();

        return JSON.parse(content);
      } catch (recoveryError) {
        console.error("Recovery failed, returning empty result");
        return null;
      }
    }
  }

  handleChange(event) {
    const changedElement = event.target;
    const optionIndex = parseInt(changedElement.dataset.optionIndex);
    if (changedElement.type === "radio") {
      const relatedSelect = this.querySelector(
        `select[data-option-index="${optionIndex}"]`
      );
      if (relatedSelect) relatedSelect.value = changedElement.value;
    } else if (changedElement.tagName === "SELECT") {
      const relatedRadios = this.querySelectorAll(
        `input[type="radio"][data-option-index="${optionIndex}"]`
      );
      relatedRadios.forEach((radio) => {
        radio.checked = radio.value === changedElement.value;
      });
    }
    if (optionIndex === 0) {
      this.resetSubsequentOptions();
    }
    this.updateOptionVisibility();
    this.currentVariant = this.getVariantData();
    const variantChangeEvent = new CustomEvent("variantChange", {
      detail: { variant: this.currentVariant },
      bubbles: true,
      composed: true,
    });
    this.dispatchEvent(variantChangeEvent);
  }

  resetSubsequentOptions() {
    const selects = this.querySelectorAll("select");
    const firstOptionValue = selects[0].value;
    const matchingVariants = this.variants.filter(
      (variant) => variant.available && variant.options[0] === firstOptionValue
    );
    for (let i = 1; i < selects.length; i++) {
      const availableValues = new Set(
        matchingVariants.map((v) => v.options[i])
      );
      const firstAvailable = Array.from(availableValues)[0];
      if (firstAvailable) {
        selects[i].value = firstAvailable;
        const radios = this.querySelectorAll(
          `input[type="radio"][data-option-index="${i}"]`
        );
        radios.forEach((radio) => {
          radio.checked = radio.value === firstAvailable;
        });
      }
    }
  }

  updateOptionVisibility() {
    const selects = Array.from(this.querySelectorAll("select"));
    const currentSelections = selects.map((select) => select.value);
    selects.length > 0 ? this.enableAllOptionsForSelect(selects[0]) : {};
    for (let i = 1; i < selects.length; i++) {
      const availableValues = this.getAvailableValues(i, currentSelections);
      const select = selects[i];
      Array.from(select.options).forEach((option) => {
        if (option.value) {
          const isAvailable = availableValues.has(option.value);
          option.disabled = !isAvailable;
          option.classList.toggle("unavailable", !isAvailable);
        }
      });
      const radios = this.querySelectorAll(
        `input[type="radio"][data-option-index="${i}"]`
      );
      radios.forEach((radio) => {
        const isAvailable = availableValues.has(radio.value);
        radio.disabled = !isAvailable;
        const swatch = radio.nextElementSibling;
        if (swatch && swatch.classList.contains("color-swatch")) {
          swatch.classList.toggle("unavailable", !isAvailable);
        }
      });
    }
  }

  enableAllOptionsForSelect(select) {
    Array.from(select.options).forEach((option) => {
      option.disabled = false;
      option.classList.remove("unavailable");
    });
    const radios = this.querySelectorAll(
      `input[type="radio"][data-option-index="${select.dataset.optionIndex}"]`
    );
    radios.forEach((radio) => {
      radio.disabled = false;
      const swatch = radio.nextElementSibling;
      if (swatch && swatch.classList.contains("color-swatch")) {
        swatch.classList.remove("unavailable");
      }
    });
  }

  getAvailableValues(optionIndex, currentSelections) {
    const matchingVariants = this.variants.filter((variant) => {
      return (
        variant.available &&
        currentSelections.every(
          (selected, idx) =>
            idx >= optionIndex || variant.options[idx] === selected
        )
      );
    });
    return new Set(
      matchingVariants.map((variant) => variant.options[optionIndex])
    );
  }

  getVariantData() {
    const selectedOptions = this.selectedOptionValues;
    if (selectedOptions.length === 0) {
      return this.variants[0];
    }
    return this.variants.find((variant) =>
      variant.options.every(
        (option, index) => option === selectedOptions[index]
      )
    );
  }

  selectInitialVariant() {
    if (this.variants.length > 1) {
      const firstAvailableVariant =
        this.currentVariant ||
        this.variants.find((variant) => variant.available);
      if (firstAvailableVariant) {
        const selects = this.querySelectorAll("select");
        const radios = this.querySelectorAll('input[type="radio"]');
        selects.forEach((select) => {
          const option = select.querySelector(
            `option[value="${
              firstAvailableVariant.options[select.dataset.optionIndex]
            }"]`
          );
          if (option) {
            option.selected = true;
          }
        });
        radios.forEach((radio) => {
          if (
            radio.value ===
            firstAvailableVariant.options[radio.dataset.optionIndex]
          ) {
            radio.checked = true;
          }
        });
        if (selects.length > 0) {
          this.currentVariant = firstAvailableVariant;
          const variantChangeEvent = new CustomEvent("variantChange", {
            detail: { variant: firstAvailableVariant },
            bubbles: true,
            composed: true,
          });
          this.dispatchEvent(variantChangeEvent);
        }
      }
    }
  }

  get selectedOptionValues() {
    return [...this.querySelectorAll("select")].map((select) => select.value);
  }
}

customElements.define("fsb-variantselector", FsVariantSelector);

/**
 * Tab navigation component
 * Manages product category tabs
 */
class FsbTabs extends HTMLElement {
  constructor() {
    super();
    this.navLinks = [];
    this.contentItems = [];
    this.hasAllTab = false;
    this.isSingleCategory = false;
    this.currentView = "products"; // Default view
  }

  connectedCallback() {
    this.navLinks = this.querySelectorAll(".tabs__navigation-link");
    this.contentItems = this.querySelectorAll(".tabs__content-item");
    this.hasAllTab = this.navLinks[0]?.classList.contains(
      "tabs__navigation-link--all"
    );
    this.isSingleCategory = this.contentItems.length === 1;

    // Initialize view-specific class on the component
    this.classList.add("fsb-view--products");

    // Initialize bundle state reference
    BundleStateManager.initBundleState.call(this);
    if (this.bundleState) {
      this.bundleState.subscribe(this, this.handleStateChange);
    }

    this.render();
    if (!this.isSingleCategory) {
      this.addEventListeners();
    }
  }

  disconnectedCallback() {
    if (this.bundleState) {
      this.bundleState.unsubscribe(this);
    }
  }

  /**
   * Handle state changes from the bundle state
   * @param {string} changeType - Type of change
   */
  handleStateChange(changeType) {
    if (changeType === "view_changed") {
      this.updateViewClasses();
    }
  }

  render() {
    if (this.isSingleCategory) {
      this.contentItems[0].classList.add("active");
      return;
    }
    if (!this.navLinks.length || !this.contentItems.length) {
      console.error("Required elements not found in FsbTabs");
      return;
    }
    this.navLinks[0].classList.add("active");
    if (this.hasAllTab) {
      this.contentItems.forEach((item) => item.classList.add("active"));
    } else {
      this.contentItems[0].classList.add("active");
    }
    if (!this.hasAllTab) {
      this.contentItems.forEach((item, index) => {
        if (index !== 0) item.classList.remove("active");
      });
    }
  }

  addEventListeners() {
    this.navLinks.forEach((link, index) => {
      link.addEventListener("click", (event) => {
        event.preventDefault();
        this.activateTab(link, index);
      });
    });
  }

  activateTab(link, index) {
    this.navLinks.forEach((link) => link.classList.remove("active"));
    link.classList.add("active");
    if (this.hasAllTab && index === 0) {
      this.contentItems.forEach((item) => item.classList.add("active"));
    } else {
      this.contentItems.forEach((item, itemIndex) => {
        if (this.hasAllTab) {
          item.classList.toggle("active", itemIndex === index - 1);
        } else {
          item.classList.toggle("active", itemIndex === index);
        }
      });
    }

    // Check if this is an add-ons tab and update the bundle state
    const tabContent = this.querySelector(`[aria-labelledby="${link.id}"]`);
    if (tabContent && tabContent.dataset.categoryName) {
      const isAddonTab =
        tabContent.dataset.categoryName.toLowerCase() === "add-ons";
      if (this.bundleState) {
        this.bundleState.currentView = isAddonTab ? "addons" : "products";
        this.bundleState.notifySubscribers("view_changed");
      } else if (window.fsBundleState) {
        window.fsBundleState.currentView = isAddonTab ? "addons" : "products";
        window.fsBundleState.notifySubscribers("view_changed");
      }

      // Update view classes directly as well
      this.currentView = isAddonTab ? "addons" : "products";
      this.updateViewClasses();
    }
  }

  /**
   * Update CSS classes based on current view
   */
  updateViewClasses() {
    const currentView = this.getCurrentView();

    // Remove all view-related classes
    this.classList.remove("fsb-view--products", "fsb-view--addons");

    // Add class for current view
    this.classList.add(`fsb-view--${currentView}`);

    // Also add class to container for easier styling
    const container = this.closest(".fsb");
    if (container) {
      container.classList.remove("fsb--products-view", "fsb--addons-view");
      container.classList.add(`fsb--${currentView}-view`);
    }
  }

  // Helper method to get the current view
  getCurrentView() {
    return this.bundleState.currentView;
  }

  isProductsView() {
    return this.getCurrentView() === "products";
  }

  isAddonsView() {
    return this.getCurrentView() === "addons";
  }
}

customElements.define("fsb-tabs", FsbTabs);
/**
 * Quantity selector component
 * Handles product quantity selection in bundle
 */
class FsbQuantitySelector extends HTMLElement {
  constructor() {
    super();
    this.decreaseBtn = null;
    this.increaseBtn = null;
    this.input = null;
    this.productCard = null;
    this.minValue = 0;
  }

  connectedCallback() {
    this.decreaseBtn = this.querySelector(".fsb__quantity-selector-decrease");
    this.increaseBtn = this.querySelector(".fsb__quantity-selector-increase");
    this.input = this.querySelector(".fsb__quantity-selector-input");
    this.productCard = this.closest("fsb-productcard");

    if (!this.productCard) {
      console.warn("FsbQuantitySelector: No parent product card found");
      return;
    }

    // Set initial value
    if (!this.input.value || this.input.value === "0") {
      this.input.value = this.minValue.toString();
    }

    // Disable decrease button initially if at minimum
    if (parseInt(this.input.value) <= this.minValue) {
      this.decreaseBtn.setAttribute("disabled", "");
    }

    // Initialize with current state from bundle
    this.syncWithBundleState();
  }

  syncWithBundleState() {
    if (!this.productCard?.currentVariant?.id) return;

    const variantId = this.productCard.currentVariant.id;
    const bundleState = this.productCard.bundleState;

    if (!bundleState) return;

    // Count quantity in bundle
    let count = 0;
    for (const key in bundleState.bundleItems) {
      const item = bundleState.bundleItems[key];
      if (item.variantId == variantId) {
        count += item.quantity;
      }
    }

    // Update input and button states
    this.input.value = count;
    this.decreaseBtn.disabled = count <= this.minValue;

    // Check if at bundle capacity
    const canAutoUpgrade = bundleState.findNextBundle() !== null;
    const isAtCapacity =
      bundleState.currentQuantity >= bundleState.bundleQuantity &&
      !canAutoUpgrade;
    this.increaseBtn.disabled = isAtCapacity;
  }
}

customElements.define("fsb-quantityselector", FsbQuantitySelector);

/**
 * Product card component
 * @customElement
 * @extends HTMLElement
 */
class FsbProductCard extends HTMLElement {
  /**
   * Constructor
   */
  constructor() {
    super();
    /**
     * @type {import('./types').BundleState}
     */
    this.bundleState = null;
    this.bindEvents();
  }

  bindEvents() {
    // Bind all event handlers to the instance
    this.handleAddToKit = this.handleAddToKit.bind(this);
    this.handleVariantChange = this.handleVariantChange.bind(this);
    this.handleStateChange = this.handleStateChange.bind(this);
    this.handleQuantityDecrease = this.handleQuantityDecrease.bind(this);
    this.handleQuantityIncrease = this.handleQuantityIncrease.bind(this);
    this.handleQuantityChange = this.handleQuantityChange.bind(this);
  }

  connectedCallback() {
    this.isAddon = this.getAttribute("is") === "fsb-productaddon";

    BundleStateManager.initBundleState.call(this);
    this.bundleState.subscribe(this, this.handleStateChange);
    this.button = this.querySelector(".fsb__atk-button--add");
    this.product = JSON.parse(this.dataset.product || "{}");
    this.category = this.dataset.category;
    this.variantSelector = this.querySelector("fsb-variantselector");
    this.currentVariant = this.variantSelector?.currentVariant;
    this.aside = document.querySelector("fsb-aside");
    this.priceElement = this.querySelector("#product-price");
    this.quantitySelector = this.querySelector("fsb-quantityselector");

    if (
      this.variantSelector?.variants.length === 0 &&
      window.fsbSettings.hide_unavailable_products
    ) {
      this.hideProduct();
      return;
    }

    this.addEventListeners();
    this.initializeProductDetails();

    // Only initialize quantity selector for regular products, not add-ons
    if (!this.isAddon && this.quantitySelector) {
      this.initQuantitySelector();
    }
    if (this.bundleState && this.product.id && !this.isAddon) {
      const variantSelector = this.querySelector("fsb-variantselector");
      if (variantSelector && variantSelector.variants) {
        const variantCount = variantSelector.variants.length;
        this.bundleState.trackProductVariants(this.product.id, variantCount);
      }
    }

    this.checkAndUpdateButtonState(this.button);
  }

  disconnectedCallback() {
    if (this.bundleState) {
      this.bundleState.unsubscribe(this);
    }

    // Remove event listeners
    if (this.button) {
      this.button.removeEventListener("click", this.handleAddToKit);
    }

    this.removeEventListener("variantChange", this.handleVariantChange);

    // Remove quantity selector event listeners
    if (this.quantitySelector) {
      const decreaseBtn = this.quantitySelector.querySelector(
        ".fsb__quantity-selector-decrease"
      );
      const increaseBtn = this.quantitySelector.querySelector(
        ".fsb__quantity-selector-increase"
      );
      const inputField = this.quantitySelector.querySelector(
        ".fsb__quantity-selector-input"
      );

      decreaseBtn?.removeEventListener("click", this.handleQuantityDecrease);
      increaseBtn?.removeEventListener("click", this.handleQuantityIncrease);
      inputField?.removeEventListener("change", this.handleQuantityChange);
    }
  }

  handleStateChange(changeType) {
    switch (changeType) {
      case "bundleItems":
        if (this.quantitySelector && !this.isAddon) {
          this.updateQuantityValue();
          this.updateQuantityButtonStates();
        }
        this.checkAndUpdateButtonState(this.button);
        break;
      case "addOnItems":
        if (this.isAddon) {
          this.checkAndUpdateButtonState(this.button);
        }
        break;
      case "bundleQuantity":
        this.checkAndUpdateButtonState(this.button);
        break;
      case "stateInitialized":
        this.checkAndUpdateButtonState(this.button);
        if (this.quantitySelector && !this.isAddon) {
          this.updateQuantityValue();
          this.updateQuantityButtonStates();
        }
        break;
    }
  }

  hideProduct() {
    this.setAttribute("hidden", "");
    if (this.button) {
      this.button.removeEventListener("click", this.handleAddToKit);
    }
    this.removeEventListener("variantChange", this.handleVariantChange);
  }

  addEventListeners() {
    if (this.button) {
      this.button.addEventListener("click", this.handleAddToKit);
    }

    this.addEventListener("variantChange", this.handleVariantChange);

    if (this.quantitySelector && !this.isAddon) {
      const decreaseBtn = this.quantitySelector.querySelector(
        ".fsb__quantity-selector-decrease"
      );
      const increaseBtn = this.quantitySelector.querySelector(
        ".fsb__quantity-selector-increase"
      );
      const inputField = this.quantitySelector.querySelector(
        ".fsb__quantity-selector-input"
      );

      decreaseBtn?.addEventListener("click", this.handleQuantityDecrease);
      increaseBtn?.addEventListener("click", this.handleQuantityIncrease);
      inputField?.addEventListener("change", this.handleQuantityChange);
    }
  }

  handleVariantChange(event) {
    this.updateProductDetails(event);
    this.checkAndUpdateButtonState(this.button);

    if (this.quantitySelector && !this.isAddon) {
      this.updateQuantityValue();
      this.updateQuantityButtonStates();
    }
    if (this.bundleState && this.product.id && !this.isAddon) {
      const variantSelector = this.querySelector("fsb-variantselector");
      if (variantSelector && variantSelector.variants) {
        const variantCount = variantSelector.variants.length;
        this.bundleState.trackProductVariants(this.product.id, variantCount);
      }
    }
  }

  checkAndUpdateButtonState(button = this.button) {
    if (!button) return;

    const variant = this.currentVariant;
    const available = this.isVariantAvailable(variant);
    button.setAttribute("data-available", available);

    if (this.isAddon) {
      // For add-ons, check against add-on limits
      if (
        this.bundleState.addOnQuantity >= this.bundleState.addOnLimits.maximum
      ) {
        button.setAttribute("disabled", "");
      } else if (variant?.id && available) {
        button.removeAttribute("disabled");
      } else {
        button.setAttribute("disabled", "");
      }
    } else {
      // For regular bundle items, check against bundle size
      const canAutoUpgrade = this.bundleState.findNextBundle() != undefined;
      const isAtCapacity =
        this.bundleState.currentQuantity >= this.bundleState.bundleQuantity &&
        !canAutoUpgrade;
      if (isAtCapacity) {
        button.setAttribute("disabled", "");
        // Also disable quantity increase button if present
        this.quantitySelector
          ?.querySelector(".fsb__quantity-selector-increase")
          ?.setAttribute("disabled", "");
      } else if (variant?.id && available) {
        button.removeAttribute("disabled");
        // Enable quantity increase button if present
        this.quantitySelector
          ?.querySelector(".fsb__quantity-selector-increase")
          ?.removeAttribute("disabled");
      } else {
        button.setAttribute("disabled", "");
        // Disable quantity increase button if present
        this.quantitySelector
          ?.querySelector(".fsb__quantity-selector-increase")
          ?.setAttribute("disabled", "");
      }
    }
  }

  isVariantAvailable(variant) {
    if (
      this.variantSelector &&
      this.variantSelector.selectedOptionValues.some((value) => !value)
    ) {
      return "unset";
    }
    if (!variant) return false;

    const inventoryPolicy = variant.inventory_policy;
    const inventoryMgmt = variant.inventory_management;
    const inventoryQuantity = variant.inventory_quantity || 0;

    if (!inventoryMgmt || inventoryPolicy === "continue") {
      return variant.available;
    }

    if (inventoryPolicy === "deny") {
      const totalBundleQuantity = Object.values(this.bundleState.bundleItems)
        .filter((item) => item.variantId === variant.id)
        .reduce((total, item) => total + item.quantity, 0);

      let totalAddonQuantity = 0;
      if (this.isAddon) {
        totalAddonQuantity = Object.values(this.bundleState.addOnItems)
          .filter((item) => item.variantId === variant.id)
          .reduce((total, item) => total + item.quantity, 0);
      }

      const totalUsedQuantity = totalBundleQuantity + totalAddonQuantity;

      return variant.available && inventoryQuantity > totalUsedQuantity;
    }

    return variant.available;
  }

  initializeProductDetails() {
    if (this.currentVariant) {
      this.updateProductDetails({
        detail: { variant: this.currentVariant, firstLoad: true },
      });
    }
    if (this.variantSelector?.variants[0]?.bundlePrice) {
      this.updateProductDetails({
        detail: { variant: this.variantSelector.variants[0], firstLoad: true },
      });
    }
  }

  handleAddToKit() {
    const variant = this.currentVariant;
    if (!variant?.id || !this.bundleState) return;

    if (this.isAddon) {
      // Add-on product logic
      if (window.fsbSettings.show_personalization) {
        const personalizationModal = document.querySelector(
          "fsb-personalization"
        );
        if (personalizationModal) {
          personalizationModal.showPersonalization(this, variant);
        }
      } else {
        if (
          this.bundleState.addOnQuantity >= this.bundleState.addOnLimits.maximum
        ) {
          const notification = document.createElement("div");
          notification.className = "fsb__notification";
          notification.textContent =
            window.fsbSettings.personalization_max_error;
          this.appendChild(notification);
          setTimeout(() => notification.remove(), 3000);
          return;
        }

        // Add addon item with unique key
        const addonData = {
          price: variant.bundlePrice,
          title: this.product.title,
          variantTitle: !variant.is_default ? variant.title : null,
          image: variant.media_link || this.product.featured_image,
        };
        this.bundleState.addAddonItem(variant.id, addonData);
      }
    } else {
      // If we have a quantity selector, use the increment functionality
      if (this.quantitySelector) {
        this.handleQuantityIncrease();
        return;
      }

      // Standard add to kit logic for non-quantity products
      if (this.bundleState.currentQuantity >= this.bundleState.bundleQuantity) {
        const canAutoUpgrade = this.bundleState.findNextBundle() !== null;

        if (canAutoUpgrade) {
          const addedSuccessfully = this.bundleState.addBundleItem(variant.id, {
            price: variant.bundlePrice,
            title: this.product.title,
            variantTitle: !variant.is_default ? variant.title : null,
            image: variant.media_link || this.product.featured_image,
            variantId: variant.id,
          });

          if (!addedSuccessfully) {
            this.showNotification(
              window.fsbSettings.personalization_max_error ||
                "Maximum bundle size reached"
            );
          }
        } else {
          this.showNotification(
            window.fsbSettings.personalization_max_error ||
              "Maximum bundle size reached"
          );
        }
      } else {
        this.bundleState.addBundleItem(variant.id, {
          price: variant.bundlePrice,
          title: this.product.title,
          variantTitle: !variant.is_default ? variant.title : null,
          image: variant.media_link || this.product.featured_image,
          variantId: variant.id,
        });
      }
    }
  }

  updateProductDetails({ detail: { variant, firstLoad = false } }) {
    this.currentVariant = variant;
    if (!variant) return;

    const priceElement = this.querySelector("#product-price");
    const imageElement = this.querySelector(".fsb__product-card__image");

    if (priceElement && variant.bundlePrice !== undefined) {
      priceElement.innerHTML =
        variant.bundlePrice === 0
          ? window.fsbSettings.free_label || "Free"
          : Fsb.formatMoney(variant.bundlePrice);
    }

    if (firstLoad === true) {
      return;
    }

    if (imageElement && variant.media_link) {
      imageElement.src = `${variant.media_link.replace("=450", "=50")}`;
      imageElement.src = `${variant.media_link}`;
      imageElement.removeAttribute("srcset");
      imageElement.alt = variant.media_alt || this.product.title || "";
    } else if (
      firstLoad === false &&
      imageElement &&
      this.product.featured_image
    ) {
      imageElement.src = `${this.product.featured_image}&width=450`;
    }
  }

  // Quantity selector methods
  initQuantitySelector() {
    if (!this.quantitySelector || this.isAddon) return;

    // Initialize to current variant quantity
    this.updateQuantityValue();
    this.updateQuantityButtonStates();
  }

  updateQuantityValue() {
    if (!this.quantitySelector || this.isAddon) return;

    const variantId = this.currentVariant?.id;
    const quantityInput = this.quantitySelector.querySelector(
      ".fsb__quantity-selector-input"
    );

    if (quantityInput && variantId) {
      const currentQuantity = this.getVariantQuantityInBundle(variantId);
      quantityInput.value = currentQuantity;
    }
  }

  getVariantQuantityInBundle(variantId) {
    if (!variantId || !this.bundleState) return 0;

    let count = 0;

    // Count all matching variants in the bundle state
    // Note: variantId might be stored as string or number, so we check both
    for (const key in this.bundleState.bundleItems) {
      const item = this.bundleState.bundleItems[key];
      if (item.variantId == variantId) {
        // Intentional loose comparison
        count += item.quantity;
      }
    }

    return count;
  }

  updateQuantityButtonStates() {
    if (!this.quantitySelector || this.isAddon) return;

    const decreaseBtn = this.quantitySelector.querySelector(
      ".fsb__quantity-selector-decrease"
    );
    const increaseBtn = this.quantitySelector.querySelector(
      ".fsb__quantity-selector-increase"
    );
    const quantityInput = this.quantitySelector.querySelector(
      ".fsb__quantity-selector-input"
    );

    if (!decreaseBtn || !increaseBtn || !quantityInput) return;

    // Disable decrease button if quantity is 0 or 1
    const currentValue = parseInt(quantityInput.value, 10) || 0;
    decreaseBtn.disabled = currentValue <= 0;

    // Disable increase button if at capacity
    const canAutoUpgrade = this.bundleState.findNextBundle() != undefined;

    const isAtCapacity =
      this.bundleState.currentQuantity >= this.bundleState.bundleQuantity &&
      !canAutoUpgrade;
    increaseBtn.disabled =
      isAtCapacity || !this.isVariantAvailable(this.currentVariant);

    if (this.getVariantQuantityInBundle(this.currentVariant.id) === 0) {
      this.quantitySelector.classList.add("hidden");
    } else {
      this.quantitySelector.classList.remove("hidden");
    }
  }

  handleQuantityDecrease() {
    if (!this.quantitySelector || this.isAddon || !this.currentVariant) return;

    const quantityInput = this.quantitySelector.querySelector(
      ".fsb__quantity-selector-input"
    );
    const variantId = this.currentVariant.id;
    const currentValue = parseInt(quantityInput.value, 10) || 0;

    if (currentValue > 0) {
      // Update input value
      const newValue = currentValue - 1;
      quantityInput.value = newValue;

      // Remove one item from bundle
      this.updateQuantityInBundle(variantId, newValue);
    }

    this.updateQuantityButtonStates();
  }

  handleQuantityIncrease() {
    if (!this.quantitySelector || this.isAddon || !this.currentVariant) return;

    const quantityInput = this.quantitySelector.querySelector(
      ".fsb__quantity-selector-input"
    );
    const variantId = this.currentVariant.id;
    const currentValue = parseInt(quantityInput.value, 10) || 0;

    // Check if we can add more
    if (this.bundleState.currentQuantity >= this.bundleState.bundleQuantity) {
      const canAutoUpgrade = this.bundleState.findNextBundle() !== null;

      if (!canAutoUpgrade) {
        Fsb.showToast(
          window.fsbSettings.personalization_max_error ||
            "Maximum bundle size reached"
        );
        return;
      }
    }

    // Update input value
    const newValue = currentValue + 1;
    quantityInput.value = newValue;

    // Add one item to bundle
    this.updateQuantityInBundle(variantId, newValue);
    this.updateQuantityButtonStates();
  }

  handleQuantityChange(event) {
    if (!this.quantitySelector || this.isAddon || !this.currentVariant) return;

    const quantityInput = event.target;
    const variantId = this.currentVariant.id;
    let newValue = parseInt(quantityInput.value, 10);

    // Enforce minimum value of 0
    if (isNaN(newValue) || newValue < 0) {
      newValue = 0;
      quantityInput.value = newValue;
    }

    // Check if we're trying to add more than the maximum bundle quantity
    const currentCount = this.bundleState.bundleItems[variantId]?.quantity || 0;
    const bundleCapacity =
      this.bundleState.bundleQuantity -
      this.bundleState.currentQuantity +
      currentCount;

    if (newValue > currentCount && newValue - currentCount > bundleCapacity) {
      const canAutoUpgrade = this.bundleState.findNextBundle() !== null;

      if (!canAutoUpgrade) {
        newValue = currentCount + bundleCapacity;
        quantityInput.value = newValue;
        Fsb.showToast("Maximum bundle size reached");
      }
    }

    // Update bundle with new quantity
    this.updateQuantityInBundle(variantId, newValue);
    this.updateQuantityButtonStates();
  }

  updateQuantityInBundle(variantId, newQuantity) {
    if (!variantId || !(this.bundleState || window.fsBundleState)) return;

    const currentQuantity =
      this.bundleState?.bundleItems[variantId]?.quantity ||
      window.fsBundleState.bundleItems[variantId]?.quantity ||
      0;

    if (newQuantity > currentQuantity) {
      // Need to add items
      const itemData = {
        price: this.currentVariant.bundlePrice,
        title: this.product.title,
        variantTitle: !this.currentVariant.is_default
          ? this.currentVariant.title
          : null,
        image: this.currentVariant.media_link || this.product.featured_image,
        variantId: this.currentVariant.id,
      };

      for (let i = 0; i < newQuantity - currentQuantity; i++) {
        this.bundleState.addBundleItem(variantId, itemData);
      }
    } else if (newQuantity < currentQuantity) {
      // Need to remove items
      let toRemove = currentQuantity - newQuantity;

      // Find items to remove

      const item =
        this.bundleState?.bundleItems[variantId] ||
        window.fsBundleState.bundleItems[variantId];
      if (item && toRemove > 0) {
        const removeCount = Math.min(toRemove, item.quantity);

        for (let i = 0; i < removeCount; i++) {
          this.bundleState
            ? this.bundleState.removeBundleItem(variantId)
            : window.fsBundleState.removeBundleItem(variantId);
        }

        toRemove -= removeCount;
      }
    }
  }
}

customElements.define("fsb-productcard", FsbProductCard);

/**
 * Bundle aside component
 * @customElement
 * @extends HTMLElement
 */
class FsbAside extends HTMLElement {
  /**
   * Constructor
   */
  constructor() {
    super();
    /**
     * @type {import('./types').BundleState}
     */
    this.bundleState = null;
    this.bundleOptions = null;
    this.continueButtons = null;
    this.addToCartButtons = null;
    this.backButtons = null;
    this.itemsContainer = null;
    this.addOnItemsSidebarContainer = null;
    this.addOnItemsContainers = null;
    this.bundlePriceElement = null;
    this.tabs = null;
    this.isExpanded = false;
    this.isMobile = window.innerWidth <= 749;
    this.bundleItemsWrapper = null;
  }

  /**
   * Called when element is connected to the DOM
   */
  connectedCallback() {
    BundleStateManager.initBundleState.call(this);
    this.bundleState.subscribe(this, this.handleStateChange);
    this.initializeElements();
    this.setupInitialState();
    this.addEventListeners();
    this.setupMobileInteraction();

    // Handle resize events
    window.addEventListener("resize", () => {
      this.isMobile = window.innerWidth <= 749;
      if (!this.isMobile) {
        this.classList.remove("expanded");
        this.isExpanded = false;
        if (this.bundleItemsWrapper) {
          this.bundleItemsWrapper.style.display = "";
        }
      }
    });
  }
  setupMobileInteraction() {
    if (!this.isMobile) return;

    const header = this.querySelector(".sidebar-header");
    this.bundleItemsWrapper = this.querySelector(".bundle-items-wrapper");

    if (!header || !this.bundleItemsWrapper) return;

    const toggleExpand = (e) => {
      if (!this.isMobile) return;

      // Don't toggle if clicking on interactive elements
      if (e.target.closest("button, a, select, input")) return;

      this.isExpanded = !this.isExpanded;
      this.classList.toggle("expanded", this.isExpanded);

      // Toggle only the bundle items wrapper
      if (this.bundleItemsWrapper) {
        this.bundleItemsWrapper.style.display = this.isExpanded
          ? "block"
          : "none";
      }
    };

    header.addEventListener("click", toggleExpand);

    // Close when clicking outside
    document.addEventListener("click", (e) => {
      if (!this.isExpanded || !this.isMobile) return;
      if (!this.contains(e.target)) {
        this.isExpanded = false;
        this.classList.remove("expanded");
        if (this.bundleItemsWrapper) {
          this.bundleItemsWrapper.style.display = "none";
        }
      }
    });
  }

  disconnectedCallback() {
    this.bundleState.unsubscribe(this);
    this.removeEventListeners();
  }

  /**
   * Handle bundle option change events
   * @param {CustomEvent} event - The bundle option change event
   */
  bundleOptionChangeHandler(event) {
    // Check if the change was automatic (e.g. from auto-sizing)
    if (this.bundleState && this.bundleState.currentView === "addons") {
      // Check if the user needs to add more products to meet the new bundle size
      if (this.bundleState.currentQuantity < this.bundleState.bundleQuantity) {
        this.backToProducts();
      }
    }
  }

  initializeElements() {
    this.bundleOptions = this.querySelector("fsb-bundleoptions");
    this.continueButtons = this.querySelectorAll(".fsb__bundle-continue");
    this.addToCartButtons = this.querySelectorAll(".fsb__bundle-add-to-cart");
    this.backButtons = this.querySelectorAll(".fsb__bundle-back");
    this.itemsContainer = this.querySelector(".bundle-items-container");
    this.addOnItemsSidebarContainer = this.querySelector(
      ".addon-items-sidebar-container"
    );
    this.addOnItemsContainers = this.querySelectorAll(".addon-items-container");
    this.bundlePriceElement = this.querySelector(".bundle-price");
    this.tabs = this.closest(".fsb__tabs");
    this.bundleState.currentView = "products";
    this.productsCountElements = document.querySelectorAll(
      ".bundle-selection-count.products"
    );
    this.addonsCountElements = document.querySelectorAll(
      ".bundle-selection-count.addons"
    );
    this.randomizeButtons = this.querySelectorAll(".fsb__button-randomize");
    setTimeout(() => {
      this.randomizeButtons.forEach((btn) => {
        btn?.classList.toggle(
          "hidden",
          !this.bundleState.checkAllProductsHaveSingleVariant()
        );
      });
    });
  }

  /**
   * Apply a function to each addon container
   * @param {Function} callback - Function to apply to each container
   */
  forEachAddonContainer(callback) {
    if (!this.addOnItemsContainers || this.addOnItemsContainers.length === 0)
      return;
    this.addOnItemsContainers.forEach((container) => callback(container));
  }

  setupInitialState() {
    this.hasAddons =
      this.addOnItemsContainers.length > 0 &&
      this.bundleState.addOnLimits.maximum > 0;
    if (this.addOnItemsSidebarContainer) {
      this.addOnItemsSidebarContainer.classList.toggle(
        "hidden",
        !this.hasAddons
      );
    }
    this.updateUI();
  }

  handleStateChange(changeType) {
    switch (changeType) {
      case "bundleItems":
        this.updateItemsDisplay();
        this.updateButtonStates();
        this.updateTotalPrice();
        this.updateSelectionCounts();
        this.updateAccordionStates();

        // Expand bundle items when item is added to bundle
        const bundleItemsContainer = this.querySelector(
          ".bundle-items-container"
        );
        const bundleDetailsWrapper = this.querySelector(
          ".fsb__bundle-details-wrapper"
        );
        if (
          bundleItemsContainer &&
          bundleDetailsWrapper &&
          !bundleItemsContainer.classList.contains("expanded")
        ) {
          this.toggleAccordion(bundleDetailsWrapper, bundleItemsContainer);
        }

        // Collapse addon items if they are expanded
        const addonItemsContainer = this.querySelector(
          ".addon-items-container.fsb__desktop-only"
        );
        const addonHeaderContainer = this.querySelector(".addon-items-header");
        if (
          addonItemsContainer &&
          addonHeaderContainer &&
          addonItemsContainer.classList.contains("expanded")
        ) {
          this.toggleAccordion(addonHeaderContainer, addonItemsContainer);
        }
        break;

      case "addOnItems":
        this.updateItemsDisplay();
        this.updateButtonStates();
        this.updateTotalPrice();
        this.updateSelectionCounts();
        this.updateAddonsVisibility();

        // Expand addon items when addon is added to bundle
        const addonContainer = this.querySelector(
          ".addon-items-container.fsb__desktop-only"
        );
        const addonHeader = this.querySelector(".addon-items-header");
        if (
          addonContainer &&
          addonHeader &&
          !addonContainer.classList.contains("expanded")
        ) {
          this.toggleAccordion(addonHeader, addonContainer);
        }

        // Collapse bundle items if they are expanded
        const bundleContainer = this.querySelector(".bundle-items-container");
        const bundleHeader = this.querySelector(".fsb__bundle-details-wrapper");
        if (
          bundleContainer &&
          bundleHeader &&
          bundleContainer.classList.contains("expanded")
        ) {
          this.toggleAccordion(bundleHeader, bundleContainer);
        }
        break;

      case "priceStrategy":
        this.updatePriceVisibility();
        this.updateTotalPrice();
        break;

      case "stateInitialized":
        this.removeExcessAddOns();
        this.removeExcessItems();
        this.updateUI();
        this.initializeAccordionStates();
        this.bundleOptionChangeHandler();
        break;

      case "view_changed":
        this.updateViewBasedUI();
        this.updateAccordionsBasedOnView();
        break;
    }
  }

  updateUI() {
    this.updateItemsDisplay();
    this.updateButtonStates();
    this.updatePriceVisibility();
    this.updateTotalPrice();
    this.updateSelectionCounts();
    this.updateViewBasedUI();
  }

  updateViewBasedUI() {
    const currentView = this.bundleState.currentView;

    if (currentView === "products") {
      // Update selection count visibility
      document
        .querySelectorAll(".bundle-selection-count.products")
        .forEach((el) => {
          el.style.display = "block";
        });
      document
        .querySelectorAll(".bundle-selection-count.addons")
        .forEach((el) => {
          el.style.display = "none";
        });
    } else if (currentView === "addons") {
      document
        .querySelectorAll(".bundle-selection-count.products")
        .forEach((el) => {
          el.style.display = "none";
        });
      document
        .querySelectorAll(".bundle-selection-count.addons")
        .forEach((el) => {
          el.style.display = "block";
        });
    }
  }

  /**
   * Sets accordion state directly without animation
   * Used for initialization and programmatic state changes
   * @param {HTMLElement} container - The accordion content container
   * @param {boolean} expanded - Whether the accordion should be expanded
   */
  setAccordionState(container, expanded = true) {
    if (!container) return;
    // Set state directly without animation
    container.style.height = expanded ? "auto" : "0px";
    container.classList.toggle("expanded", expanded);

    // Find and update the matching header's icon if possible
    const header = this.getAccordionHeaderForContent(container);
    if (header) {
      const icon = header.querySelector(".icon-caret");
      if (icon) {
        icon.classList.toggle("icon-caret--rotated", expanded);
      }
    }
  }

  /**
   * Helper to find the header element for a given accordion content
   * @param {HTMLElement} contentContainer - The accordion content element
   * @returns {HTMLElement|null} - The header element or null
   */
  getAccordionHeaderForContent(contentContainer) {
    if (!contentContainer) return null;

    // Determine which header this content belongs to
    if (contentContainer.classList.contains("bundle-items-container")) {
      return this.querySelector(".fsb__bundle-details-wrapper");
    } else if (contentContainer.classList.contains("addon-items-container")) {
      return this.querySelector(".addon-items-header");
    }
    return null;
  }

  /**
   * Helper to set caret (arrow) visibility and interactivity
   * @param {HTMLElement} icon
   * @param {boolean} visible
   */
  setCaretState(icon, visible = true) {
    if (!icon) return;
    icon.classList.toggle("hidden", !visible);
    icon.setAttribute("aria-hidden", String(!visible));
    icon.style.pointerEvents = visible ? "" : "none";
    icon.tabIndex = visible ? 0 : -1;
  }

  /**
   * Initializes accordion functionality for bundle containers
   */
  initializeAccordions() {
    // Only enable accordion logic if both products and add-ons are available
    if (!this.hasAddons) {
      // Always expand bundle items and disable caret
      this.setAccordionState(
        this.querySelector(".bundle-items-container"),
        true
      );
      this.setCaretState(
        this.querySelector(".fsb__bundle-details-wrapper .icon-caret"),
        false
      );
      return;
    }
    // Setup accordion for bundle items wrapper
    const bundleItemsWrapper = this.querySelector(
      ".fsb__bundle-details-wrapper"
    );
    if (bundleItemsWrapper) {
      const bundleItemsContainer = this.querySelector(
        ".bundle-items-container"
      );
      if (bundleItemsContainer) {
        bundleItemsWrapper.addEventListener("click", (e) => {
          if (!this.hasAddons) return; // Guard
          if (
            e.target.closest("button:not(.accordion-toggle), a, select, input")
          )
            return;
          this.toggleAccordion(bundleItemsWrapper, bundleItemsContainer);
        });
      }
    }
    // Setup accordion for add-on items container
    const addonHeaderContainer = this.querySelector(".addon-items-header");
    if (addonHeaderContainer) {
      const addonItemsContainer = this.querySelector(
        ".addon-items-container.fsb__desktop-only"
      );
      if (addonItemsContainer) {
        addonHeaderContainer.addEventListener("click", (e) => {
          if (!this.hasAddons) return; // Guard
          if (
            e.target.closest("button:not(.accordion-toggle), a, select, input")
          )
            return;
          this.toggleAccordion(addonHeaderContainer, addonItemsContainer);
        });
      }
    }
    this.updateAddonsVisibility();
  }

  /**
   * Toggles the accordion with animation effects
   * Used for user interactions
   * @param {HTMLElement} header - The accordion header element
   * @param {HTMLElement} content - The accordion content container
   */
  toggleAccordion(header, content) {
    if (!this.hasAddons && !this.isMobile) return;

    // Toggle expanded class
    const isExpanded = !content.classList.contains("expanded");
    content.classList.toggle("expanded", isExpanded);

    // Update icon rotation
    const icon = header.querySelector(".icon-caret");
    if (icon) {
      icon.classList.toggle("icon-caret--rotated", isExpanded);
    }

    // Apply height transition
    if (isExpanded) {
      // Expanding animation
      const contentHeight = content.scrollHeight;
      content.style.height = "0px";
      content.offsetHeight; // Force reflow
      content.style.height = `${contentHeight}px`;

      // Reset to auto after animation completes
      content.addEventListener(
        "transitionend",
        () => {
          content.style.height = "auto";
        },
        { once: true }
      );
    } else {
      // Collapsing animation
      const currentHeight = content.scrollHeight;
      content.style.height = `${currentHeight}px`;
      content.offsetHeight; // Force reflow
      content.style.height = "0px";

      // Add proper cleanup after collapse animation completes
      content.addEventListener(
        "transitionend",
        () => {
          // Keep height at 0px but remove inline style if no longer needed
          if (!content.classList.contains("expanded")) {
            content.style.height = "0px";
          }
        },
        { once: true }
      );
    }
  }

  /**
   * Updates the visibility of add-on related elements based on add-on availability
   */
  updateAddonsVisibility() {
    // Use helper for caret and container
    const hasAddons = this.hasAddons;
    this.setCaretState(
      this.querySelector(".fsb__bundle-details-wrapper .icon-caret"),
      hasAddons
    );
    if (this.addOnItemsSidebarContainer) {
      this.addOnItemsSidebarContainer.classList.toggle("hidden", !hasAddons);
    }
  }
  updateSelectionCounts() {
    // Update products count
    this.productsCountElements.forEach((element) => {
      if (element) {
        const selectedProducts = this.bundleState.currentQuantity;
        const maxProducts = this.bundleState.bundleQuantity || 0;
        element.textContent = `${selectedProducts}/${maxProducts} ${window.fsbSettings.bundle_selection_count_text}`;
      }
    });

    // Update add-ons count
    this.addonsCountElements.forEach((element) => {
      if (element) {
        const selectedAddons = this.bundleState.addOnQuantity;
        const minAddons = this.bundleState.addOnLimits.minimum;
        const maxAddons = this.bundleState.addOnLimits.maximum;

        let addonText = "";
        if (minAddons === maxAddons) {
          // Fixed quantity case
          if (minAddons === 1) {
            addonText = window.fsbSettings.addons_text
              .replace("[qty]", minAddons)
              .replace("add-ons", "add-on");
          } else {
            addonText = window.fsbSettings.addons_text.replace(
              "[qty]",
              minAddons
            );
          }
        } else {
          // Range case
          addonText = window.fsbSettings.addons_text_different
            .replace("[min]", minAddons)
            .replace("[max]", maxAddons);
        }

        element.textContent = addonText.replace("[selected]", selectedAddons);
      }
    });
  }

  addEventListeners() {
    // Bind methods once
    this.continueToAddOns = this.continueToAddOns.bind(this);
    this.backToProducts = this.backToProducts.bind(this);
    this.handleRandomize = this.handleRandomize.bind(this);

    // Add listeners to all instances of each button
    this.addToCartButtons.forEach((button) => {
      button.addEventListener("click", () => this.addBundleToCart());
    });

    this.continueButtons.forEach((button) => {
      button.addEventListener("click", this.continueToAddOns);
    });

    this.backButtons.forEach((button) => {
      button.addEventListener("click", this.backToProducts);
    });

    this.randomizeButtons.forEach((button) => {
      button.addEventListener("click", this.handleRandomize);
    });

    this.initializeAccordions();
  }

  updateAddonsContainerInfo() {
    const addonsSidebarContainer = this.addOnItemsSidebarContainer;
    if (addonsSidebarContainer) {
      addonsSidebarContainer.classList.toggle("hidden", !this.hasAddons);
    }
  }

  updateItemsDisplay() {
    this.updateBundleItems();
    this.updateAddonItems();
  }

  updateBundleItems() {
    const currentItems = this.itemsContainer.querySelectorAll(
      ".bundle-item:not([data-bundle-item-template])"
    );
    const currentItemsMap = new Map();

    // Create a map of existing DOM elements by item key
    currentItems.forEach((item) => {
      const itemKey = item.getAttribute("data-item-key");
      if (itemKey) currentItemsMap.set(itemKey, item);
    });

    // Track keys that should exist after update
    const updatedItemKeys = new Set();

    // Update existing items or add new ones
    Object.entries(this.bundleState.bundleItems).forEach(
      ([itemKey, itemData]) => {
        updatedItemKeys.add(itemKey);
        const { variantId, title, variantTitle, image, price, quantity } =
          itemData;
        const variantData = {
          id: variantId,
          title: variantTitle,
          media_link: image,
          bundlePrice: price,
        };
        const productData = { title, featured_image: image };

        if (currentItemsMap.has(itemKey)) {
          // Update existing item
          this.updateItemInDOM(currentItemsMap.get(itemKey), itemData);
        } else {
          // Add new item
          this.addItemToDOM(
            itemKey,
            variantData,
            productData,
            this.itemsContainer
          );
        }
      }
    );

    // Remove items that no longer exist in the state
    currentItemsMap.forEach((element, key) => {
      if (!updatedItemKeys.has(key)) {
        element.remove();
      }
    });

    // Add placeholder if bundle is empty
    if (Object.keys(this.bundleState.bundleItems).length === 0) {
      const existingPlaceholder =
        this.itemsContainer.querySelector(".items-placeholder");
      if (existingPlaceholder) existingPlaceholder.removeAttribute("hidden");
    } else {
      // Hide any existing placeholder if items exist
      const existingPlaceholder =
        this.itemsContainer.querySelector(".items-placeholder");
      if (existingPlaceholder) existingPlaceholder.setAttribute("hidden", true);
    }
  }

  updateItemInDOM(itemElement, itemData) {
    if (!itemElement) return;

    // Update quantity
    const qtyElement = itemElement.querySelector(".bundle-item__qty");
    if (qtyElement) {
      qtyElement.textContent = itemData.quantity;
    }

    // Update price if needed
    const priceElement = itemElement.querySelector(".bundle-item__price");
    if (priceElement) {
      priceElement.innerHTML =
        itemData.price === 0
          ? window.fsbSettings.free_label || "Free"
          : Fsb.formatMoney(itemData.price);
    }

    // Only update other elements if they've changed
    // This avoids unnecessary DOM operations
    const nameElement = itemElement.querySelector(".bundle-item__name");
    if (nameElement && nameElement.textContent !== itemData.title) {
      nameElement.textContent = itemData.title;
    }

    const variantTitleElement = itemElement.querySelector(
      ".bundle-item__variant-title"
    );
    if (
      variantTitleElement &&
      itemData.variantTitle &&
      variantTitleElement.textContent !== itemData.variantTitle
    ) {
      variantTitleElement.textContent = itemData.variantTitle;
    }

    const imageElement = itemElement.querySelector(".bundle-item__image");
    if (imageElement && imageElement.src !== itemData.image) {
      imageElement.src = itemData.image || imageElement.src;
    }
  }

  updateAddonItems() {
    // Apply to each addon container
    this.forEachAddonContainer((container) => {
      // First remove existing addon items
      const addonItems = container.querySelectorAll(
        ".bundle-item:not([data-bundle-item-template])"
      );
      addonItems.forEach((item) => item.remove());

      // Then add updated items to this container
      Object.entries(this.bundleState.addOnItems).forEach(
        ([variantId, itemData]) => {
          const { title, image, price, personalization, variantTitle } =
            itemData;
          const variantData = {
            id: variantId,
            media_link: image,
            bundlePrice: price,
            personalization: personalization,
            title: variantTitle || "",
          };
          const productData = { title, featured_image: image };
          this.addItemToDOM(variantId, variantData, productData, container);
        }
      );

      // Add placeholder if bundle is empty
      if (Object.keys(this.bundleState.addOnItems).length === 0) {
        this.addOnItemsContainers.forEach((container) => {
          container.querySelector(".items-placeholder")
            ? container
                .querySelector(".items-placeholder")
                .removeAttribute("hidden")
            : null;
        });
      } else {
        this.addOnItemsContainers.forEach((container) => {
          container.querySelector(".items-placeholder")
            ? container
                .querySelector(".items-placeholder")
                .setAttribute("hidden", true)
            : null;
        });
      }
    });
  }

  updateButtonStates() {
    this.updateAddToCartButtonState();
    this.updateContinueButtonState();
    this.updateBackButtonState();
  }

  shouldDisableAddToCart() {
    if (
      this.hasAddons &&
      this.bundleState.addOnLimits.maximum > 0 &&
      this.bundleState.addOnQuantity < this.bundleState.addOnLimits.minimum
    )
      return true;
    return !!(
      this.bundleState.currentQuantity !== this.bundleState.bundleQuantity
    );
  }

  shouldDisableContinue() {
    return this.bundleState.currentQuantity !== this.bundleState.bundleQuantity;
  }

  updateAddToCartButtonState() {
    if (this.addToCartButtons.length === 0) return;
    const isDisabled = this.shouldDisableAddToCart();
    const shouldHide = this.hasAddons && !this.isInAddOnsSection();

    this.addToCartButtons.forEach((button) => {
      button.disabled = isDisabled;
      button.classList.toggle("hidden", shouldHide);
    });
  }

  updateContinueButtonState() {
    if (this.continueButtons.length === 0) return;
    const isDisabled = this.shouldDisableContinue();
    const shouldHide = !this.hasAddons || this.isInAddOnsSection();

    this.continueButtons.forEach((button) => {
      button.disabled = isDisabled;
      button.classList.toggle("hidden", shouldHide);
    });

    const shouldHideRandomize =
      this.isInAddOnsSection() ||
      !this.bundleState.checkAllProductsHaveSingleVariant();

    this.randomizeButtons.forEach((button) => {
      button.classList.toggle("hidden", shouldHideRandomize);
    });
  }

  updateBackButtonState() {
    if (this.backButtons.length === 0) return;
    const shouldHide = !this.isInAddOnsSection();

    this.backButtons.forEach((button) => {
      button.classList.toggle("hidden", shouldHide);
    });
  }

  isInAddOnsSection() {
    return (
      this.closest(".fsb__tabs")
        .querySelector(".fsb__addons-container")
        ?.classList.contains("hidden") === false
    );
  }

  continueToAddOns() {
    if (!this.hasAddons) return;
    const container = this.closest(".fsb__tabs");
    container.querySelector(".fsb__tabs-container")?.classList.add("hidden");
    container.querySelector(".tabs__navigation")?.classList.add("hidden");
    container
      .querySelector(".fsb__addons-container")
      ?.classList.remove("hidden");
    this.updateButtonStates();
    this.bundleState.currentView = "addons";
    this.bundleState.notifySubscribers("view_changed");
    container.scrollIntoView({ top: "80px", behavior: "smooth" });
  }

  backToProducts() {
    const container = this.closest(".fsb__tabs");
    container.querySelector(".fsb__tabs-container")?.classList.remove("hidden");
    container.querySelector(".tabs__navigation")?.classList.remove("hidden");
    container.querySelector(".fsb__addons-container")?.classList.add("hidden");
    this.updateButtonStates();
    container.scrollIntoView({ top: "80px", behavior: "smooth" });
    this.bundleState.currentView = "products";
    this.bundleState.notifySubscribers("view_changed");
  }

  updatePriceVisibility(
    priceStrategy = this.bundleState.priceStrategy.strategy
  ) {
    const tabsContainer = document.querySelector(".fsb__tabs-container");
    if (tabsContainer) {
      if (priceStrategy === "fixed_pricing") {
        tabsContainer.classList.add("fsb__price-hidden");
      } else {
        tabsContainer.classList.remove("fsb__price-hidden");
      }
    }
  }

  parseBundleSettings() {
    const settingsString = this.getAttribute("data-bundle-settings");
    if (settingsString) {
      try {
        const settings = JSON.parse(settingsString);
        this.addOnLimits = settings.add_on || this.addOnLimits;
        this.priceStrategy = settings.price || this.priceStrategy;
      } catch (error) {
        console.error("Error parsing data-bundle-settings:", error);
      }
    }
  }

  initializeBundleQuantity(bundleOptions) {
    const selectedOption = bundleOptions.querySelector("[selected]");
    if (selectedOption) {
      this.bundleQuantity =
        parseInt(selectedOption.getAttribute("data-quantity")) || 0;
      this.selectedOption = selectedOption.dataset.optionId;
      const optionSettings = JSON.parse(selectedOption.dataset.option || "{}");
      if (optionSettings.add_on) {
        this.addOnLimits = optionSettings.add_on;
      }
      if (optionSettings.price) {
        this.priceStrategy = optionSettings.price;
      }
    } else {
      console.warn("No selected option found in fsb-bundleoptions.");
    }
  }

  addBundleToCart() {
    if (this.shouldDisableAddToCart()) {
      this.showErrorMessage(
        window.fsbSettings.addon_required_message ||
          "Please add the minimum required add-ons to continue."
      );
      return;
    }

    this.selectedOption =
      this.bundleState.selectedOption || this.dataset.variant;
    const identifier = `${bundleId}_${Date.now()}`;
    this.hideError();

    // Prepare bundle line items for Foxsell's cart transform
    const bundleLineItemProperties = this.prepareFoxsellBundleItems();
    const selectedItemsProperties = this.prepareSelectedItemsProperties();

    // Create cart form data - SINGLE line item for the parent bundle product
    const addToCartFormData = {
      items: [
        {
          id: parseInt(this.selectedOption, 10), // Parent bundle product variant ID
          quantity: 1,
          properties: {
            ...selectedItemsProperties,
            // Foxsell's cart transform properties
            "__foxsell:dynamic_add_on_bundle_id": identifier,
            "__foxsell:dynamic_add_on_bundle_items": JSON.stringify(
              bundleLineItemProperties
            ),
          },
        },
      ],
      // sections: ["cart-drawer", "cart-icon-bubble"],
    };

    // Add to cart with proper error handling
    this.submitCartRequest(addToCartFormData);
  }

  prepareFoxsellBundleItems() {
    // Format bundle items for Foxsell's cart transform
    const bundleItems = Object.entries(this.bundleState.bundleItems).map(
      ([itemKey, itemData]) => ({
        variantId: parseInt(itemData.variantId, 10),
        quantity: itemData.quantity,
        type: "product", // Foxsell expects this type
        properties: {}, // Regular bundle items don't need special properties
      })
    );

    // Format addon items for Foxsell's cart transform
    const addonItems = Object.entries(this.bundleState.addOnItems).map(
      ([itemKey, itemData]) => ({
        variantId: parseInt(itemData.variantId, 10),
        quantity: itemData.quantity,
        type: "addOns", // Foxsell expects this type for add-ons
        properties: {
          // Only add personalization if it exists
          ...(itemData.personalization && {
            [window.fsbSettings.personalization_property_name ||
            "Gift Message"]: itemData.personalization,
          }),
        },
      })
    );

    return [...bundleItems, ...addonItems];
  }

  prepareBundleLineItems() {
    const bundleItems = Object.entries(this.bundleState.bundleItems).map(
      ([variantId, itemData]) => ({
        variantId: parseInt(variantId, 10),
        quantity: itemData.quantity,
        type: "product",
        properties: {},
      })
    );

    const addonItems = Object.entries(this.bundleState.addOnItems).map(
      ([variantId, itemData]) => ({
        variantId: parseInt(variantId, 10),
        quantity: itemData.quantity,
        type: "addOns",
        properties: {
          [window.fsbSettings.personalization_property_name || "Gift Message"]:
            itemData.personalization || "",
        },
      })
    );

    return [...bundleItems, ...addonItems];
  }

  prepareSelectedItemsProperties() {
    const properties = {};
    const propNameKey =
      window.fsbSettings.personalization_property_name || "Gift Message";

    // Combine bundle and addon items to process in a single loop
    const allItems = [
      ...Object.entries(this.bundleState.bundleItems).map(([id, data]) => ({
        ...data,
        isAddon: false,
      })),
      ...Object.entries(this.bundleState.addOnItems).map(([id, data]) => ({
        ...data,
        isAddon: true,
      })),
    ];

    // Process all items in one pass
    allItems.forEach((itemData) => {
      const itemName = itemData.title;

      // Update or set quantity string
      if (properties[itemName]) {
        const currentCount = parseInt(
          properties[itemName].replace(/[^0-9]/g, "")
        );
        properties[itemName] = `x${currentCount + itemData.quantity}`;
      } else {
        properties[itemName] = `x${itemData.quantity}`;
      }

      // Add personalization as separate property if present
      if (itemData.personalization) {
        const safeKey = `${itemName} - ${propNameKey}`.substring(0, 40);
        properties[safeKey] = itemData.personalization.substring(0, 100);
      }
    });

    return properties;
  }

  submitCartRequest(data) {
    fetch(window.Shopify.routes.root + "cart/add.js", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data),
    })
      .then((response) => response.json())
      .then((response) => {
        if (response.status) {
          this.handleErrorMessage(response.description);
          return;
        }

        this.showSuccessMessage(
          window.fsbSettings.added_toast_message ||
            "Bundle successfully added to cart!"
        );
        this.updateCartUI(response);
      })
      .catch((error) => {
        console.error("Error adding bundle to cart:", error);
        this.showErrorMessage(
          window.fsbSettings.cart_error_message ||
            "An error occurred while adding to cart. Please try again."
        );
      });
  }

  // 5. Optimize error message handling
  showErrorMessage(message) {
    const errorMessageWrapper = document.querySelector(
      ".fsb__error-message-wrapper"
    );
    if (!errorMessageWrapper) return;

    const errorMessageElement = errorMessageWrapper.querySelector(
      ".fsb__error-message"
    );
    if (errorMessageElement) {
      errorMessageElement.textContent = message;
    }

    errorMessageWrapper.toggleAttribute("hidden", !message);
    console.error("Error:", message);
  }

  handleErrorMessage(errorMessage) {
    const soldOutMessage = this.submitButton.querySelector(".sold-out-message");
    this.showErrorMessage(errorMessage);
    if (soldOutMessage) {
      this.submitButton.setAttribute("aria-disabled", true);
      this.submitButtonText.classList.add("hidden");
      soldOutMessage.classList.remove("hidden");
    }
    this.error = true;
  }

  showSuccessMessage(message) {
    // Remove any existing toast
    let toast = document.querySelector(".fsb__toast");
    if (!toast) {
      toast = document.createElement("div");
      toast.className = "fsb__toast";
      toast.setAttribute("role", "status");
      toast.setAttribute("aria-live", "polite");
      document.body.appendChild(toast);
    }
    toast.textContent = message;
    toast.classList.add("fsb__toast--visible");

    // Remove after 2.5s
    clearTimeout(this._toastTimeout);
    this._toastTimeout = setTimeout(() => {
      toast.classList.remove("fsb__toast--visible");
    }, 2000);

    // Allow dismiss on click
    toast.onclick = () => {
      toast.classList.remove("fsb__toast--visible");
      clearTimeout(this._toastTimeout);
    };
  }

  hideError() {
    const errorMessageWrapper = document.querySelector(
      ".fsb__error-message-wrapper"
    );
    errorMessageWrapper.setAttribute("hidden", "");
  }

  showErrorMessage(message) {
    const errorMessageWrapper = document.querySelector(
      ".fsb__error-message-wrapper"
    );
    const errorMessageElement = errorMessageWrapper.querySelector(
      ".fsb__error-message"
    );
    errorMessageWrapper.toggleAttribute("hidden", !message);
    if (message) {
      errorMessageElement.textContent = message;
    }
    console.error("Error:", message);
  }

  updateCartUI(response) {
    console.log("Updating cart UI...");
    console.log("Cart response:", response);

    if (fsbAdditionalSettings?.custom_cart_event) {
      const events = fsbAdditionalSettings.custom_cart_event
        .split(",")
        .map((event) => event.trim());
      events.forEach((event) => {
        document.dispatchEvent(
          new CustomEvent(event, {
            bubbles: true,
          })
        );
      });
    }

    // First, fetch the updated cart data from /cart.js
    fetch("/cart.json")
      // .then(response => response.json())
      .then((cartData) => {
        console.log(cartData);
        // Update cart count elements
        const cartCountElements = document.querySelectorAll(".js-cartCount");
        cartCountElements.forEach((element) => {
          element.textContent = cartData.item_count || 0;
        });

        // Try to open the cart drawer (mini cart)
        const cartDrawer = document.querySelector("cart-drawer");
        if (cartDrawer) {
          try {
            // If the cart drawer has a renderContents method, use it with the fetched cart data
            if (typeof cartDrawer.renderContents === "function") {
              cartDrawer.renderContents(cartData);
            }

            // Open the cart drawer
            if (typeof cartDrawer.open === "function") {
              cartDrawer.open();
            }

            // Remove empty class if it exists
            if (cartDrawer.classList.contains("is-empty")) {
              cartDrawer.classList.remove("is-empty");
            }
          } catch (e) {
            console.warn(
              "Cart drawer methods not available, trying alternative approach"
            );
            this.openMiniCartAlternative();
          }
        } else {
          // Try alternative selectors for the mini cart
          this.openMiniCartAlternative();
        }
      })
      .catch((error) => {
        console.error("Error fetching cart data:", error);
        // Fallback to opening mini cart without updated data
        this.openMiniCartAlternative();
      });
  }

  // Helper method to try alternative ways to open the mini cart
  openMiniCartAlternative() {
    // Try common mini cart selectors and methods
    const miniCartSelectors = [
      ".js-cartToggle",
      ".cart-toggle",
      ".mini-cart-toggle",
      "#cart-icon-bubble",
      ".cart-drawer-toggle",
    ];

    for (const selector of miniCartSelectors) {
      const toggle = document.querySelector(selector);
      if (toggle) {
        toggle.click();
        return;
      }
    }

    // Try dispatching a custom cart event
    document.dispatchEvent(new CustomEvent("cart:open", { bubbles: true }));

    // If all else fails, check if there's a global cart open function
    if (window.openCartDrawer && typeof window.openCartDrawer === "function") {
      window.openCartDrawer();
    } else if (window.cart && typeof window.cart.open === "function") {
      window.cart.open();
    } else {
      // Last resort - show a success message instead of redirecting
      this.showSuccessMessage(
        window.fsbSettings.added_toast_message ||
          "Bundle successfully added to cart! Check your cart to proceed to checkout."
      );
    }
  }

  isAllTabActive() {
    return this.tabs
      ?.querySelector(".tabs__navigation-link.active")
      ?.classList.contains("tabs__navigation-link--all");
  }

  getCurrentTabIndex() {
    const activeTab = this.tabs.querySelector(".tabs__navigation-link.active");
    return Array.from(
      this.tabs.querySelectorAll(".tabs__navigation-link")
    ).indexOf(activeTab);
  }

  /**
   * Handles click on the randomize button
   * Clears the current bundle and fills it with random products
   */
  handleRandomize() {
    // Display a notification to the user
    Fsb.showToast(window.fsbSettings.randomize_notification);

    // Get all eligible products efficiently
    const availableProducts = this.getRandomizableProducts();

    if (!availableProducts.length) {
      return;
    }

    // Calculate how many more items we need to add
    const targetQuantity = this.bundleState.bundleQuantity;
    const currentQuantity = this.bundleState.currentQuantity;
    const itemsToAdd = Math.max(0, targetQuantity - currentQuantity);

    if (itemsToAdd === 0) {
      return;
    }

    // Randomize the bundle with safety limits
    const addedCount = this.randomizeBundleWithProducts(
      availableProducts,
      itemsToAdd
    );
  }

  /**
   * Gets all products that can be randomized
   * Filters for single-variant products that are available and visible
   * @returns {Array} Array of eligible products
   */
  getRandomizableProducts() {
    // Create a Set to avoid duplicate products
    const productSet = new Set();
    // Cache for variant availability status
    const availabilityCache = new Map();

    // Get active tabs (categories) once
    const activeTabs = document.querySelectorAll(".tabs__content-item.active");

    // Process each active tab
    activeTabs.forEach((tab) => {
      // Only process visible product cards - do this once per tab
      const productCards = tab.querySelectorAll(
        'fsb-productcard:not([hidden]):not([is="fsb-productaddon"])'
      );

      productCards.forEach((card) => {
        try {
          // Check for valid product data
          if (!card.dataset.product) return;

          const productData = JSON.parse(card.dataset.product);
          const variantSelector = card.querySelector("fsb-variantselector");

          // Skip invalid products
          if (!variantSelector || !productData.id) return;

          // Get variants and check if there's only one
          const variants = variantSelector.variants || [];
          if (variants.length !== 1) return;

          const variant = variants[0];
          const cacheKey = `${productData.id}-${variant.id}`;

          // Check cache for availability status
          let isAvailable = availabilityCache.get(cacheKey);

          if (isAvailable === undefined) {
            // Use the card's availability check method
            isAvailable =
              card.isVariantAvailable &&
              card.isVariantAvailable(variant) === true;
            availabilityCache.set(cacheKey, isAvailable);
          }

          if (isAvailable) {
            // Use the variant ID as a key to avoid duplicates
            if (!productSet.has(variant.id)) {
              productSet.add(variant.id);
              // Store minimal required data
              const product = {
                card,
                product: productData,
                variant: variant,
              };
              // Precompute any necessary properties right away
              product.key = variant.id;
              product.bundleData = {
                price: variant.bundlePrice,
                title: productData.title,
                variantTitle: !variant.is_default ? variant.title : null,
                image: variant.media_link || productData.featured_image,
                variantId: variant.id,
                productId: productData.id,
              };
              productSet.add(product);
            }
          }
        } catch (e) {
          // Silently handle errors without breaking the flow
        }
      });
    });

    // Convert set to array for further processing
    return Array.from(productSet).filter((item) => typeof item === "object");
  }

  /**
   * Fills the bundle with randomly selected products
   * @param {Array} availableProducts Array of eligible products
   * @param {Number} itemsToAdd Number of items to add
   * @returns {Number} Number of items actually added
   */
  randomizeBundleWithProducts(availableProducts, itemsToAdd) {
    if (!availableProducts.length || itemsToAdd <= 0) {
      return 0;
    }

    // Shuffle the products efficiently
    const shuffledProducts = this.shuffleArray(availableProducts);

    // Keep track of how many products we've added
    let addedCount = 0;

    // Safety limits to prevent infinite loops
    const maxAttempts = Math.min(availableProducts.length * 3, 100);
    let attempts = 0;

    // Set of variant IDs we've already tried to add
    const attemptedVariants = new Set();

    // Add products until we reach the target or hit safety limits
    while (addedCount < itemsToAdd && attempts < maxAttempts) {
      attempts++;

      // If we've tried all products at least once, get a random one
      const index =
        attempts <= shuffledProducts.length
          ? attempts - 1
          : Math.floor(Math.random() * shuffledProducts.length);

      const product = shuffledProducts[index];

      // Skip if we've already tried this variant
      if (attemptedVariants.has(product.key)) {
        continue;
      }

      // Mark this variant as attempted
      attemptedVariants.add(product.key);

      const success = this.bundleState.addBundleItem(
        product.key,
        product.bundleData
      );

      if (success) {
        addedCount++;

        // If we've added enough items, stop
        if (addedCount >= itemsToAdd) {
          break;
        }
      }
    }

    // Return the number of items we successfully added
    return addedCount;
  }

  /**
   * Shuffles array using Fisher-Yates algorithm
   * @param {Array} array The array to shuffle
   * @returns {Array} New shuffled array
   */
  shuffleArray(array) {
    // Create a copy to avoid modifying the original
    const shuffled = Array.from(array);

    // Fisher-Yates shuffle algorithm
    for (let i = shuffled.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
    }

    return shuffled;
  }

  addItemToDOM(itemKey, variantData, productData, container) {
    const template = this.querySelector("[data-bundle-item-template]");
    if (!template || !container) return;
    const clone = template.cloneNode(true);
    const itemElement = clone.querySelector(".bundle-item");
    itemElement.classList.remove("hidden");
    itemElement.setAttribute("data-item-key", itemKey);
    const imageElement = itemElement.querySelector(".bundle-item__image");
    if (imageElement) {
      if (variantData.media_link || productData.featured_image) {
        imageElement.src = variantData.media_link || productData.featured_image;
        imageElement.alt = productData.title || "";
        imageElement.classList.remove("hidden");
      } else {
        imageElement.classList.add("hidden");
      }
    }
    const nameElement = itemElement.querySelector(".bundle-item__name");
    if (nameElement) {
      nameElement.textContent = productData.title;
    }
    const variantTitleElement = itemElement.querySelector(
      ".bundle-item__variant-title"
    );
    if (variantTitleElement && variantData.title) {
      variantTitleElement.textContent = variantData.title;
    }
    const qtyElement = itemElement.querySelector(".bundle-item__qty");
    if (
      qtyElement &&
      (this.bundleState.bundleItems[itemKey]?.quantity ||
        this.bundleState.addOnItems[itemKey].quantity)
    ) {
      qtyElement.textContent =
        this.bundleState.bundleItems[itemKey]?.quantity ||
        this.bundleState.addOnItems[itemKey]?.quantity;
    }
    const priceElement = itemElement.querySelector(".bundle-item__price");
    if (priceElement) {
      priceElement.innerHTML =
        variantData.bundlePrice === 0
          ? window.fsbSettings.free_label || "Free"
          : Fsb.formatMoney(variantData.bundlePrice);
    }
    const removeButton = itemElement.querySelector(".bundle-item__remove");
    if (removeButton) {
      const isAddon =
        container === this.addOnItemsContainers[0] ||
        container === this.addOnItemsContainers[1];

      removeButton.addEventListener("click", () => {
        if (isAddon) {
          this.bundleState.removeAddonItem(itemKey);
        } else {
          FsbProductCard.prototype.updateQuantityInBundle(itemKey, 0);
        }
      });
    }

    // Check if this is an add-on item with personalization
    if (
      (container === this.addOnItemsContainers[0] ||
        container === this.addOnItemsContainers[1]) &&
      variantData.personalization
    ) {
      if (itemElement) {
        const detailsElement = itemElement.querySelector(
          ".bundle-item__details"
        );

        if (detailsElement) {
          // Add View Message button after the name
          const viewMessageButton = document.createElement("button");
          viewMessageButton.className = "fsb__button--link";
          viewMessageButton.textContent = `${window.fsbSettings.view_message_button_text}`;
          nameElement.parentNode.insertBefore(
            viewMessageButton,
            nameElement.nextSibling
          );

          // Add click handler to open personalization modal
          viewMessageButton.addEventListener("click", () => {
            const personalizationModal = document.querySelector(
              "fsb-personalization"
            );
            if (personalizationModal) {
              // Create a dummy product card with necessary data
              productData.button = viewMessageButton;
              const dummyProductCard = {
                product: productData,
                bundleState: this.bundleState,
              };

              // Show the modal with existing data
              personalizationModal.showPersonalizationWithData(
                dummyProductCard,
                variantData,
                variantData.personalization,
                itemKey
              );
            }
          });

          const personalizationElement = document.createElement("p");
          personalizationElement.className = "bundle-item__personalization";
          // Prepend a pencil icon and truncate the message to ~30 characters
          const preview =
            variantData.personalization.length > 30
              ? variantData.personalization.substring(0, 27) + "..."
              : variantData.personalization;
          // Use the merchant-defined property name in the tooltip/title
          personalizationElement.innerHTML = `<span class="personalization-icon">✏️</span> ${preview}`;
          // If truncated, add a tooltip with the full message
          if (variantData.personalization.length > 30) {
            personalizationElement.title = variantData.personalization;
          }
          detailsElement.appendChild(personalizationElement);
        }
      }
    }

    container.appendChild(itemElement);
  }

  removeItemFromDOM(itemKey, container) {
    // If a specific container is provided, remove from just that container
    if (container) {
      const itemToRemove = container.querySelector(
        `[data-item-key="${itemKey}"]`
      );
      if (itemToRemove) {
        container.removeChild(itemToRemove);
      }
      return;
    }

    if (this.bundleState.addOnItems[itemKey]) {
      this.forEachAddonContainer((container) => {
        const itemToRemove = container.querySelector(
          `[data-item-key="${itemKey}"]`
        );
        if (itemToRemove) {
          container.removeChild(itemToRemove);
        }
      });
    } else {
      // Otherwise, it's a bundle item, remove from bundle container
      const itemToRemove = this.itemsContainer.querySelector(
        `[data-item-key="${itemKey}"]`
      );
      if (itemToRemove) {
        this.itemsContainer.removeChild(itemToRemove);
      }
    }
  }

  removeVariantFromBundle(itemKey) {
    const variantRemovedEvent = new CustomEvent("variantRemovedFromBundle", {
      detail: { itemKey },
      bubbles: true,
      composed: true,
    });
    this.dispatchEvent(variantRemovedEvent);
  }

  removeAddonVariantFromBundle(variantId) {
    const addonVariantRemovedEvent = new CustomEvent("addonVariantRemoved", {
      detail: { variantId },
      bubbles: true,
      composed: true,
    });
    this.dispatchEvent(addonVariantRemovedEvent);
  }

  updateAddToBundleButtons() {
    const addToBundleButtons = document.querySelectorAll(
      ".fsb__atk-button--add"
    );
    addToBundleButtons.forEach((button) => {
      const productCard = button.closest("fsb-productcard, fsb-productaddon");
      if (productCard) {
        productCard.checkAndUpdateButtonState(this.button);
      }
    });
  }

  removeEventListeners() {
    // Remove event listeners from all button instances
    this.addToCartButtons.forEach((button) => {
      button.removeEventListener("click", this.addBundleToCart);
    });

    this.continueButtons.forEach((button) => {
      button.removeEventListener("click", this.continueToAddOns);
    });

    this.backButtons.forEach((button) => {
      button.removeEventListener("click", this.backToProducts);
    });

    this.randomizeButtons.forEach((button) => {
      button.removeEventListener("click", this.handleRandomize);
    });
  }

  removeExcessAddOns(newMaximum = this.bundleState.addOnLimits.maximum) {
    while (this.bundleState.addOnQuantity > newMaximum) {
      const variantIds = Object.keys(this.bundleState.addOnItems);
      if (variantIds.length === 0) break;

      const lastVariantId = variantIds[variantIds.length - 1];
      this.bundleState.removeAddonItem(lastVariantId);
      this.updateAddToBundleButtons();

      // This will now remove from all addon containers
      this.removeItemFromDOM(lastVariantId);
    }
  }

  removeExcessItems() {
    const excessQuantity =
      this.bundleState.currentQuantity - this.bundleState.bundleQuantity;
    if (excessQuantity <= 0) return;
    const itemKeys = Object.keys(this.bundleState.bundleItems);
    itemKeys.sort(
      (b, a) =>
        this.bundleState.bundleItems[b].addedAt -
        this.bundleState.bundleItems[a].addedAt
    );
    let remainingToRemove = excessQuantity;
    let currentKeyIndex = itemKeys.length - 1;
    while (remainingToRemove > 0 && currentKeyIndex >= 0) {
      const itemKey = itemKeys[currentKeyIndex];
      const item = this.bundleState.bundleItems[itemKey];
      const removeFromThis = Math.min(remainingToRemove, item.quantity);
      for (let i = 0; i < removeFromThis; i++) {
        this.bundleState.removeBundleItem(itemKey);
      }
      remainingToRemove -= removeFromThis;
      currentKeyIndex--;
    }
    this.updateAddToBundleButtons();
    this.updateTotalPrice();
    this.updateButtonStates();
  }

  updateTotalPrice() {
    let bundleItemsTotal = 0;
    let addOnItemsTotal = 0;
    Object.values(this.bundleState.bundleItems).forEach((item) => {
      bundleItemsTotal += item.price * item.quantity;
    });
    Object.values(this.bundleState.addOnItems).forEach((item) => {
      if (item?.price) {
        addOnItemsTotal += item.price * item.quantity;
      }
    });

    // For dynamic pricing strategies that might need recalculation
    if (this.bundleState.priceStrategy.strategy === "fixed_pricing") {
      const finalPrice =
        this.bundleState.priceStrategy.value * 100 + addOnItemsTotal;

      this.updateBundlePrice(finalPrice);
    } else if (this.bundleState.priceStrategy.strategy === "dynamic_pricing") {
      const discountPercentage = this.bundleState.priceStrategy.value / 100;
      const originalPrice = bundleItemsTotal + addOnItemsTotal;
      const discountAmount = bundleItemsTotal * discountPercentage;
      const finalPrice = originalPrice - discountAmount;
      this.updateBundlePrice(finalPrice, originalPrice);
    } else {
      this.updateBundlePrice(bundleItemsTotal + addOnItemsTotal);
    }
  }

  updateBundlePrice(finalPrice, originalPrice = null) {
    if (!this.bundlePriceElement) return;
    if (originalPrice) {
      this.bundlePriceElement.innerHTML = `
        <span class="original-price">${Fsb.formatMoney(originalPrice)}</span>
        <span class="discounted-price">${Fsb.formatMoney(finalPrice)}</span>
      `;
      this.bundlePriceElement.classList.add("has-discount");
    } else {
      this.bundlePriceElement.innerHTML = Fsb.formatMoney(finalPrice);
      this.bundlePriceElement.classList.remove("has-discount");
    }
  }

  /**
   * Initialize accordion states based on initial content
   */
  initializeAccordionStates() {
    const bundleContainer = this.querySelector(".bundle-items-container");
    const bundleCaret = this.querySelector(
      ".fsb__bundle-details-wrapper .icon-caret"
    );
    const addonContainer = this.querySelector(
      ".addon-items-container.fsb__desktop-only"
    );
    const addonCaret = this.querySelector(".addon-items-header .icon-caret");

    const inProductsView = this.bundleState.currentView === "products";
    const inAddonsView = this.bundleState.currentView === "addons";

    if (!this.hasAddons) {
      // Without add-ons: always expand bundle items and hide accordions on desktop
      this.setAccordionState(bundleContainer, true);
      this.setCaretState(bundleCaret, false);

      // Hide add-on elements
      this.setAccordionState(addonContainer, false);
      this.setCaretState(addonCaret, false);
    } else {
      // With add-ons: set initial states based on current view
      this.setAccordionState(bundleContainer, inProductsView);
      this.setCaretState(bundleCaret, true);

      this.setAccordionState(addonContainer, inAddonsView);
      this.setCaretState(addonCaret, true);
    }

    this.updateAddonsVisibility();
  }

  /**
   * Updates accordion states based on content changes
   */
  updateAccordionStates() {
    // If bundle items container is expanded, update its height
    const bundleItemsContainer = this.querySelector(".bundle-items-container");
    if (
      bundleItemsContainer &&
      bundleItemsContainer.classList.contains("expanded")
    ) {
      // Allow height to adjust to new content
      bundleItemsContainer.style.height = "auto";
      const newHeight = bundleItemsContainer.scrollHeight;
      bundleItemsContainer.style.height = `${newHeight}px`;
    }

    // If addon items container is expanded, update its height
    const addonItemsContainer = this.querySelector(
      ".addon-items-container.fsb__desktop-only"
    );
    if (
      addonItemsContainer &&
      addonItemsContainer.classList.contains("expanded")
    ) {
      // Allow height to adjust to new content
      addonItemsContainer.style.height = "auto";
      const newHeight = addonItemsContainer.scrollHeight;
      addonItemsContainer.style.height = `${newHeight}px`;
    }
  }

  /**
   * Updates accordions based on current view
   */
  updateAccordionsBasedOnView() {
    const currentView = this.bundleState.currentView;
    const bundleItemsContainer = this.querySelector(".bundle-items-container");
    const bundleDetailsWrapper = this.querySelector(
      ".fsb__bundle-details-wrapper"
    );
    const addonItemsContainer = this.querySelector(
      ".addon-items-container.fsb__desktop-only"
    );
    const addonHeaderContainer = this.querySelector(".addon-items-header");

    if (
      !bundleItemsContainer ||
      !bundleDetailsWrapper ||
      !addonItemsContainer ||
      !addonHeaderContainer
    ) {
      return;
    }

    if (currentView === "products") {
      // Expand bundle items if not already expanded
      if (!bundleItemsContainer.classList.contains("expanded")) {
        this.toggleAccordion(bundleDetailsWrapper, bundleItemsContainer);
      }

      // Collapse addon items if expanded
      if (addonItemsContainer.classList.contains("expanded")) {
        this.toggleAccordion(addonHeaderContainer, addonItemsContainer);
      }
    } else if (currentView === "addons") {
      // Expand addon items if not already expanded
      if (!addonItemsContainer.classList.contains("expanded")) {
        this.toggleAccordion(addonHeaderContainer, addonItemsContainer);
      }

      // Collapse bundle items if expanded
      if (bundleItemsContainer.classList.contains("expanded")) {
        this.toggleAccordion(bundleDetailsWrapper, bundleItemsContainer);
      }
    }
  }
}

customElements.define("fsb-aside", FsbAside);

/**
 * Popover UI component
 * Handles dropdown menus and tooltips
 */
class FsbPopover extends HTMLElement {
  constructor() {
    super();
    this.isOpen = false;
    this.trigger = null;
    this.content = null;
  }

  connectedCallback() {
    this.trigger = this.querySelector(".fsb__popover-trigger");
    this.content = this.querySelector(".fsb__popover-content");
    if (!this.trigger || !this.content) {
      console.error("FsbPopover: Missing trigger or content element");
      return;
    }
    this.trigger.addEventListener("click", () => this.toggle());
    this.handleOutsideClick = this.handleOutsideClick.bind(this);
    document.addEventListener("click", this.handleOutsideClick);
  }

  toggle() {
    this.isOpen ? this.close() : this.open();
  }

  open() {
    this.isOpen = true;
    this.content.classList.add("fsb__popover-content--active");
    this.trigger.setAttribute("aria-expanded", "true");
  }

  close() {
    this.isOpen = false;
    this.content.classList.remove("fsb__popover-content--active");
    this.trigger.setAttribute("aria-expanded", "false");
  }

  handleOutsideClick(event) {
    if (this.isOpen && !this.contains(event.target)) {
      this.close();
    }
  }
}

customElements.define("fsb-popover", FsbPopover);

/**
 * Base modal dialog component
 * Handles basic modal functionality
 */
class FsbModalDialog extends HTMLElement {
  constructor() {
    super();
    this.closer = this.querySelector('[id^="ModalClose"]');
    this.content = this.querySelector(".fsb__modal-content");
    this.openedBy = null;
    this.previouslyFocusedElement = null;

    // Bind methods
    this.handleKeyup = this.handleKeyup.bind(this);
    this.handleOutsideClick = this.handleOutsideClick.bind(this);
    this.hide = this.hide.bind(this);
  }

  connectedCallback() {
    if (!this.moved) {
      this.moved = true;
      document.body.appendChild(this);
    }
    this.setupEventListeners();
  }

  disconnectedCallback() {
    this.removeEventListeners();
  }

  setupEventListeners() {
    this.closer?.addEventListener("click", this.hide);
    this.addEventListener("keyup", this.handleKeyup);
    this.addEventListener("click", this.handleOutsideClick);
  }

  removeEventListeners() {
    this.closer?.removeEventListener("click", this.hide);
    this.removeEventListener("keyup", this.handleKeyup);
    this.removeEventListener("click", this.handleOutsideClick);
  }

  handleKeyup(event) {
    if (event.code.toUpperCase() === "ESCAPE") this.hide();
  }

  handleOutsideClick(event) {
    if (event.target === this) this.hide();
  }

  show(opener) {
    this.openedBy = opener;
    document.body.classList.add("overflow-hidden");
    this.previouslyFocusedElement = document.activeElement;

    this.setAttribute("open", "");
    this.setAttribute("role", "dialog");
    this.setAttribute("aria-modal", "true");

    this.setAttribute("tabindex", "-1");
    this.focus();

    queueMicrotask(() => {
      this.content.scrollTop = 0;
      this.trapFocus();
    });
  }

  hide() {
    document.body.classList.remove("overflow-hidden");
    this.removeAttribute("open");
    this.restoreFocus();
    this.cleanup();
    document.body.dispatchEvent(new CustomEvent("modalClosed"));
  }

  trapFocus() {
    const focusableElements = this.querySelectorAll(
      'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
    );

    if (focusableElements.length) {
      this.firstFocusable = focusableElements[0];
      this.lastFocusable = focusableElements[focusableElements.length - 1];
      this.firstFocusable.focus();
      this.addEventListener("keydown", this.handleTabKey);
    }
  }

  handleTabKey(e) {
    if (e.key !== "Tab") return;

    if (e.shiftKey) {
      if (document.activeElement === this.firstFocusable) {
        e.preventDefault();
        this.lastFocusable.focus();
      }
    } else {
      if (document.activeElement === this.lastFocusable) {
        e.preventDefault();
        this.firstFocusable.focus();
      }
    }
  }

  restoreFocus() {
    if (this.openedBy) {
      this.openedBy.button?.focus();
    }
  }

  cleanup() {
    this.content.innerHTML = "";
    this.removeEventListener("keydown", this.handleTabKey);
    this.removeAttribute("role");
    this.removeAttribute("aria-modal");
    this.firstFocusable = null;
    this.lastFocusable = null;
  }
}

customElements.define("fsb-modaldialog", FsbModalDialog);

/**
 * Product modal dialog component
 * Extends base modal with product-specific functionality
 */
class FsbProductModal extends FsbModalDialog {
  constructor() {
    super();
    this.currentProduct = null;
    this.variantSelector = null;
    this.mediaGallery = null;
    this.productCard = null;
    this.buttonObserver = null;
    this.variantObserver = null;

    // Bind additional methods
    this.handleVariantChange = this.handleVariantChange.bind(this);
    this.addEventListener("variantChange", this.handleVariantChange);
    this.handleProductImageClick = this.handleProductImageClick.bind(this);
    this.handleProductImageKeydown = this.handleProductImageKeydown.bind(this);
    this.delegatedClickHandler = this.delegatedClickHandler.bind(this);
    this.delegatedKeydownHandler = this.delegatedKeydownHandler.bind(this);
  }

  connectedCallback() {
    super.connectedCallback();
    this.setupProductImageListeners();

    const productContainer = document.querySelector(".fsb__tabs");
    if (productContainer) {
      productContainer.addEventListener("click", this.delegatedClickHandler);
      productContainer.addEventListener(
        "keydown",
        this.delegatedKeydownHandler
      );
    }
  }

  delegatedClickHandler(event) {
    const productImage = event.target.closest(
      ".fsb__category-grid__product-card .fsb__product-card__image"
    );
    if (productImage) {
      // Use the original handler logic with the found element
      this.handleProductImageClick(event, productImage);
    }
  }

  delegatedKeydownHandler(event) {
    const productImage = event.target.closest(
      ".fsb__category-grid__product-card .fsb__product-card__image"
    );
    if (productImage && (event.key === "Enter" || event.key === " ")) {
      event.preventDefault();
      this.handleProductImageClick(event, productImage);
    }
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    document.removeEventListener("click", this.handleProductImageClick);
  }

  setupProductImageListeners() {
    document
      .querySelectorAll(
        ".fsb__category-grid__product-card .fsb__product-card__image"
      )
      .forEach((image) => {
        image.removeEventListener("click", this.handleProductImageClick);
        image.addEventListener("click", this.handleProductImageClick);

        // Make image focusable with keyboard
        if (!image.hasAttribute("tabindex")) {
          image.setAttribute("tabindex", "0");
        }

        // Add keyboard event listener
        image.removeEventListener("keydown", this.handleProductImageKeydown);
        image.addEventListener("keydown", this.handleProductImageKeydown);
      });
  }

  removeProductImageListeners() {
    document
      .querySelectorAll(
        ".fsb__category-grid__product-card .fsb__product-card__image"
      )
      .forEach((image) => {
        image.removeEventListener("click", this.handleProductImageClick);
        image.removeEventListener("keydown", this.handleProductImageKeydown);
      });
  }

  handleProductImageClick(event, productImage = event.currentTarget) {
    event.preventDefault();
    event.stopPropagation();

    if (!productImage) return;

    const productCard = productImage.closest(
      ".fsb__category-grid__product-card"
    );
    if (!productCard) return;

    if (
      event.target.closest("fsb-variantselector") ||
      event.target.closest(".fsb__atk-button")
    ) {
      return;
    }

    this.showProduct(productImage);
  }

  showProduct(opener) {
    this.productCard = opener.closest(".fsb__category-grid__product-card");

    try {
      this.currentProduct = JSON.parse(this.productCard.dataset.product);
      super.show(this.productCard);
      this.setupModalContent();
      this.setupStateSynchronization();
    } catch (error) {
      console.error("Error setting up product modal:", error);
      this.hide();
    }
  }

  setupModalContent() {
    if (!this.content || !this.currentProduct) return;

    const modalHTML = this.createModalHTML();
    this.content.innerHTML = modalHTML;

    this.setupMediaGallery();
    this.setupVariantSelector();
    this.setupAddToCartButton();
  }

  createModalHTML() {
    const { title, description } = this.currentProduct;
    const { price } = this.productCard.variantSelector.currentVariant;

    return `
      <div class="fsb__modal-layout">
        <div class="fsb__modal-media" id="modal-media"></div>
        <div class="fsb__modal-details">
          <h2 class="fsb__modal-title">${title}</h2>
          <div class="fsb__modal-price">${Fsb.formatMoney(price)}</div>
          <div class="fsb__modal-variant-container fsb__category-grid__product-card"></div>
          <div class="fsb__modal-description">${description || ""}</div>
          <div class="fsb__modal-actions fsb__category-grid__product-card">
          ${Array.from(this.productCard.querySelectorAll(".fsb__atk-button"))
            .map((button) => button.outerHTML)
            .join("")}
          </div>
        </div>
      </div>
    `;
  }

  setupStateSynchronization() {
    const originalSelector = this.productCard.querySelector(
      "fsb-variantselector"
    );
    const modalSelector = this.content.querySelector("fsb-variantselector");

    if (originalSelector && modalSelector) {
      this.setupVariantSync(originalSelector, modalSelector);
    }

    const modalButtons = this.content.querySelectorAll(".fsb__atk-button");
    const originalButtons =
      this.productCard.querySelectorAll(".fsb__atk-button");

    if (modalButtons.length && originalButtons.length) {
      this.setupButtonSync(originalButtons, modalButtons);
    }
  }

  setupVariantSync(originalSelector, modalSelector) {
    this.syncVariantState(originalSelector, modalSelector);

    modalSelector.addEventListener("change", (event) => {
      const { name, value } = event.target;
      const originalSelect = originalSelector.querySelector(
        `select[name="${name}"]`
      );
      if (originalSelect && originalSelect.value !== value) {
        originalSelect.value = value;
        originalSelect.dispatchEvent(new Event("change", { bubbles: true }));
      }
    });

    this.variantObserver = new MutationObserver((mutations) => {
      mutations.forEach((mutation) => {
        if (
          mutation.type === "attributes" &&
          mutation.attributeName === "value"
        ) {
          const originalSelect = mutation.target;
          const modalSelect = modalSelector.querySelector(
            `select[name="${originalSelect.name}"]`
          );
          if (modalSelect && modalSelect.value !== originalSelect.value) {
            modalSelect.value = originalSelect.value;
            modalSelect.dispatchEvent(new Event("change", { bubbles: true }));
          }
        }
      });
    });

    originalSelector.querySelectorAll("select").forEach((select) => {
      this.variantObserver.observe(select, {
        attributes: true,
        attributeFilter: ["value"],
      });
    });
  }

  syncVariantState(originalSelector, modalSelector) {
    modalSelector.querySelectorAll("select").forEach((select) => {
      const originalSelect = originalSelector.querySelector(
        `select[name="${select.name}"]`
      );
      if (originalSelect) {
        select.value = originalSelect.value;
      }
    });

    modalSelector.querySelectorAll('input[type="radio"]').forEach((input) => {
      const originalInput = originalSelector.querySelector(
        `input[type="radio"][name="${input.name}"][value="${input.value}"]`
      );
      if (originalInput) {
        input.checked = originalInput.checked;
      }
    });
  }

  setupButtonSync(originalButtons, modalButtons) {
    const syncButtonStates = () => {
      modalButtons.forEach((modalButton, index) => {
        const originalButton = originalButtons[index];
        if (originalButton) {
          modalButton.disabled = originalButton.disabled;
          modalButton.classList = originalButton.classList;
          modalButton.textContent = originalButton.textContent;
          modalButton.dataset.available = originalButton.dataset.available;
        }
      });
    };

    syncButtonStates();

    this.buttonObserver = new MutationObserver(syncButtonStates);

    originalButtons.forEach((button) => {
      this.buttonObserver.observe(button, {
        attributes: true,
        attributeFilter: ["disabled", "class", "data-available"],
        childList: true,
        characterData: true,
      });
    });

    modalButtons.forEach((modalButton, index) => {
      modalButton.addEventListener("click", () => {
        const originalButton = originalButtons[index];
        if (originalButton && !originalButton.disabled) {
          originalButton.click();
          this.hide();
        }
      });
    });
  }

  handleVariantChange(event) {
    const { variant } = event.detail;
    if (!variant) return;

    const priceElement = this.content.querySelector(".fsb__modal-price");
    if (priceElement && variant.price) {
      priceElement.innerHTML = Fsb.formatMoney(variant.price);
    }

    if (variant.featured_image) {
      this.mediaGallery?.updateMainImage(variant.featured_image);
    }
  }

  setupMediaGallery() {
    const mediaContainer = this.content.querySelector("#modal-media");
    if (!mediaContainer) return;

    this.mediaGallery = new FsbProductGallery(
      mediaContainer,
      this.currentProduct.media || [],
      this.currentProduct.featured_image
    );
    this.mediaGallery.init();
  }

  setupVariantSelector() {
    const container = this.content.querySelector(
      ".fsb__modal-variant-container"
    );
    if (!container) return;

    const originalSelector = this.openedBy
      ?.closest(".fsb__category-grid__product-card")
      ?.querySelector("fsb-variantselector");

    if (originalSelector) {
      this.variantSelector = this.cloneVariantSelector(originalSelector);
      container.appendChild(this.variantSelector);

      this.variantSelector.addEventListener("variantChange", (event) => {
        const originalEvent = new CustomEvent("variantChange", {
          detail: event.detail,
          bubbles: true,
        });
        originalSelector.dispatchEvent(originalEvent);
      });
    }
  }

  cloneVariantSelector(original) {
    const clone = document.createElement("fsb-variantselector");
    clone.innerHTML = original.innerHTML;

    Array.from(original.attributes).forEach((attr) => {
      if (attr.name !== "id") {
        clone.setAttribute(attr.name, attr.value);
      }
    });

    clone.querySelectorAll("[id]").forEach((element) => {
      element.id = `modal-${element.id}`;
    });

    return clone;
  }

  setupAddToCartButton() {
    const button = this.content.querySelector(".fsb__atk-button");
    if (!button) return;

    button.addEventListener("click", () => {
      const originalButton = this.openedBy
        ?.closest(".fsb__category-grid__product-card")
        ?.querySelector(
          `.fsb__atk-button[data-action="${button.dataset.action}"`
        );

      if (originalButton) {
        originalButton.click();
        this.hide();
      }
    });
  }

  cleanup() {
    this.buttonObserver?.disconnect();
    this.variantObserver?.disconnect();
    this.buttonObserver = null;
    this.variantObserver = null;
    this.currentProduct = null;
    this.productCard = null;
    this.mediaGallery?.destroy();
    this.mediaGallery = null;
    this.variantSelector = null;
    super.cleanup();
  }

  handleProductImageKeydown(event) {
    if (fsbAdditionalSettings.show_popup === true) {
      if (event.key === "Enter" || event.key === " ") {
        const handleProductImageClick =
          document.querySelector("fsb-product-modal").handleProductImageClick;
        event.preventDefault();
        handleProductImageClick(event);
      }
    }
  }
}

customElements.define("fsb-product-modal", FsbProductModal);

/**
 * Product gallery handler for modal
 * Manages media display and thumbnails
 */
class FsbProductGallery {
  constructor(container, mediaItems = [], fallbackImage = null) {
    this.container = container;
    this.mediaItems = mediaItems;
    this.fallbackImage = fallbackImage;
    this.currentIndex = 0;
  }

  init() {
    this.container.innerHTML = this.createGalleryHTML();

    if (this.mediaItems.length > 0) {
      this.setupMediaElements();
    } else if (this.fallbackImage) {
      this.setupFallbackImage();
    }

    this.setupEventListeners();
  }

  createGalleryHTML() {
    return `
      <div class="fsb__gallery-main"></div>
      ${
        this.mediaItems.length > 1
          ? '<div class="fsb__gallery-thumbs"></div>'
          : ""
      }
    `;
  }

  setupMediaElements() {
    const mainContainer = this.container.querySelector(".fsb__gallery-main");
    const thumbsContainer = this.container.querySelector(
      ".fsb__gallery-thumbs"
    );

    // Setup main image
    const mainImage = this.createImage(this.mediaItems[0].src);
    mainContainer.appendChild(mainImage);

    // Setup thumbnails if multiple images
    if (thumbsContainer && this.mediaItems.length > 1) {
      const fragment = document.createDocumentFragment();

      for (const [index, media] of this.mediaItems.entries()) {
        const thumb = this.createThumbnail(media, index === 0);
        fragment.appendChild(thumb);
      }

      thumbsContainer.appendChild(fragment);
    }
  }

  createImage(src, alt = "") {
    const img = new Image();
    img.src = src;
    img.alt = alt;
    img.className = "fsb__gallery-image";
    return img;
  }

  createThumbnail(media, isActive = false) {
    const thumb = document.createElement("button");
    thumb.className = `fsb__gallery-thumb ${isActive ? "is-active" : ""}`;
    thumb.setAttribute("aria-label", `View ${media.alt || "product image"}`);

    const img = this.createImage(`${media.src}&width=100`, media.alt);
    thumb.appendChild(img);

    return thumb;
  }

  setupFallbackImage() {
    const mainContainer = this.container.querySelector(".fsb__gallery-main");
    const img = new Image();
    img.src = this.fallbackImage;
    img.alt = "";
    img.className = "fsb__gallery-image";
    mainContainer.appendChild(img);
  }

  setupEventListeners() {
    const thumbsContainer = this.container.querySelector(
      ".fsb__gallery-thumbs"
    );
    if (!thumbsContainer) return;

    thumbsContainer.addEventListener("click", (e) => {
      const thumb = e.target.closest(".fsb__gallery-thumb");
      if (!thumb) return;

      const index = Array.from(thumbsContainer.children).indexOf(thumb);
      this.updateMainImage(index);
    });
  }

  updateMainImage(index) {
    if (index === this.currentIndex) return;

    const mainImage = this.container.querySelector(".fsb__gallery-main img");
    if (!mainImage) return;

    const media = this.mediaItems[index];
    mainImage.src = media.src;
    mainImage.alt = media.alt || "";

    // Update thumbnails
    const thumbs = this.container.querySelectorAll(".fsb__gallery-thumb");
    thumbs.forEach((thumb, i) => {
      thumb.classList.toggle("is-active", i === index);
    });

    this.currentIndex = index;
  }

  destroy() {
    this.container.innerHTML = "";
  }
}

customElements.define("fsb-product-gallery", FsbProductGallery);

/**
 * Personalization modal component
 * Extends base modal with personalization functionality
 */
class FsbPersonalizationModal extends FsbModalDialog {
  constructor() {
    super();
    this.currentVariant = null;
    this.productCard = null;
    this.maxLength = window.fsbSettings.personalization_char;

    // Set up modal event listeners
    this.setupEventListeners();
  }

  showPersonalization(productCard, variant) {
    this.productCard = productCard;
    this.currentVariant = variant;
    this.setupModalContent();
    super.show(productCard);
  }

  setupModalContent() {
    if (!this.content || !this.currentVariant) return;

    const modalHTML = this.createModalHTML();
    this.content.innerHTML = modalHTML;
    this.setupFormEventListeners();

    // Focus the textarea after content is set up
    queueMicrotask(() => {
      const messageArea = this.content.querySelector("#addon-message");
      if (messageArea) messageArea.focus();
    });
  }

  setupFormEventListeners() {
    const messageArea = this.content.querySelector("#addon-message");
    const charCount = this.content.querySelector("#char-count");
    const addButton = this.content.querySelector("#add-personalization");
    const cancelButton = this.content.querySelector("#cancel-personalization");

    messageArea?.addEventListener("input", (e) => {
      const count = e.target.value.length;
      if (charCount) charCount.textContent = count;
    });

    addButton?.addEventListener("click", () => {
      const message = messageArea?.value || "";
      this.handleAddToBundle(message);
    });

    cancelButton?.addEventListener("click", () => {
      this.hide();
    });
  }

  createModalHTML() {
    const { title } = this.productCard.product;
    const imageUrl =
      this.currentVariant.media_link || this.productCard.product.featured_image;
    const displayTitle =
      this.currentVariant.title && !this.currentVariant.is_default
        ? `${title} - ${this.currentVariant.title}`
        : title;

    return `
    <div class="fsb__personalization-modal">
      <h2 class="fsb__personalization-title">${displayTitle}</h2>
      <div class="fsb__personalization-layout">
        ${
          imageUrl
            ? `<div class="fsb__personalization-image-container">
                  <img src="${imageUrl}" alt="${title}" class="fsb__personalization-image">
                </div>`
            : ""
        }
        <div class="fsb__personalization-content">
          <div class="fsb__personalization-form">
            <label for="addon-message" class="fsb__personalization-label">
              ${window.fsbSettings.personalization_title}
            </label>
            <textarea 
              id="addon-message" 
              class="fsb__personalization-textarea" 
              placeholder="${window.fsbSettings.personalization_placeholder}"
              maxlength="${this.maxLength}"
            ></textarea>
            <div class="fsb__personalization-counter">
              <span id="char-count">0</span>/${this.maxLength}
            </div>
          </div>
          <div class="fsb__personalization-actions">
            <button type="button" class="fsb__button fsb__button-inverted" id="cancel-personalization">
              ${window.fsbSettings.personalization_cancel}
            </button>
            <button type="button" class="fsb__button" id="add-personalization">
              ${window.fsbSettings.personalization_add}
            </button>
          </div>
        </div>
      </div>
    </div>
    `;
  }

  handleAddToBundle(message) {
    if (!this.currentVariant?.id || !this.productCard?.bundleState) return;

    if (this.itemKey) {
      // Update existing item
      const addonItems = this.productCard.bundleState.addOnItems;
      if (addonItems[this.itemKey]) {
        addonItems[this.itemKey].personalization = message.trim();
        this.productCard.bundleState.notifySubscribers("addOnItems");
      }
    } else {
      // Add new item
      if (
        this.productCard.bundleState.addOnQuantity >=
        this.productCard.bundleState.addOnLimits.maximum
      ) {
        const notification = document.createElement("div");
        notification.className = "fsb__notification";
        notification.textContent = window.fsbSettings.personalization_max_error;
        this.productCard.appendChild(notification);
        setTimeout(() => notification.remove(), 3000);
        return;
      }

      this.productCard.bundleState.addAddonItem(this.currentVariant.id, {
        price: this.currentVariant.bundlePrice,
        title: this.productCard.product.title,
        variantTitle: !this.currentVariant.is_default
          ? this.currentVariant.title
          : null,
        image:
          this.currentVariant.media_link ||
          this.productCard.product.featured_image,
        personalization: message.trim(),
      });
    }

    this.hide();
  }

  hide() {
    super.hide();
  }

  cleanup() {
    this.currentVariant = null;
    this.productCard = null;
    this.itemKey = null;
    super.cleanup();
  }

  showPersonalizationWithData(productCard, variant, existingMessage, itemKey) {
    this.productCard = productCard;
    this.currentVariant = variant;
    this.itemKey = itemKey;
    this.setupModalContent();
    super.show(productCard);

    // Pre-fill the message
    const messageArea = this.content.querySelector("#addon-message");
    const charCount = this.content.querySelector("#char-count");
    if (messageArea && existingMessage) {
      messageArea.value = existingMessage;
      if (charCount) {
        charCount.textContent = existingMessage.length;
      }
    }

    // Update the add button text to indicate editing
    const addButton = this.content.querySelector("#add-personalization");
    if (addButton) {
      // Use "Update" + property name to clearly indicate what's being updated
      addButton.textContent =
        window.fsbSettings.personalization_add ||
        `${window.fsbSettings.personalization_property_name}`;
    }
  }
}

customElements.define("fsb-personalization", FsbPersonalizationModal);

/**
 * Product dropdown component
 * Handles dropdown selection and integration with bundle state
 */
class FsbProductDropdown extends HTMLElement {
  constructor() {
    super();
    this.dropdownIndex = this.getAttribute("data-dropdown-index");
    this.select = null;
    this.bundleState = null;
  }

  connectedCallback() {
    this.select = this.querySelector(".fsb__dropdown-select");
    if (!this.select) return;

    // Initialize bundle state
    BundleStateManager.initBundleState.call(this);
    this.bundleState.subscribe(this, this.handleStateChange.bind(this));

    // Add event listener
    this.select.addEventListener(
      "change",
      this.handleDropdownChange.bind(this)
    );
  }

  disconnectedCallback() {
    if (this.bundleState) {
      this.bundleState.unsubscribe(this);
    }
  }

  handleDropdownChange(event) {
    const selectedValue = event.target.value;
    const selectedOption = event.target.options[event.target.selectedIndex];

    if (!selectedValue) {
      // If empty option selected, remove any existing item for this dropdown
      this.removeExistingDropdownItem();
      return;
    }

    // Remove any existing item for this dropdown first
    this.removeExistingDropdownItem();

    // Get variant data from the selected option
    const variantId = selectedValue;
    const productId = selectedOption.getAttribute("data-product-id");
    const productTitle = selectedOption.getAttribute("data-product-title");
    const variantTitle = selectedOption.getAttribute("data-variant-title");
    const price = parseInt(selectedOption.getAttribute("data-price"));
    const image = selectedOption.getAttribute("data-image");

    // Create bundle item data
    const itemData = {
      price: price,
      title: productTitle,
      variantTitle: variantTitle || null,
      image: image,
      variantId: variantId,
      dropdownIndex: this.dropdownIndex,
    };

    // Add to bundle with dropdown-specific key
    const itemKey = `dropdown_${this.dropdownIndex}_${variantId}`;
    this.bundleState.addBundleItem(itemKey, itemData);
  }

  removeExistingDropdownItem() {
    // Find and remove any existing item for this dropdown
    const bundleItems = this.bundleState.bundleItems;
    const dropdownPrefix = `dropdown_${this.dropdownIndex}_`;

    for (const itemKey in bundleItems) {
      if (itemKey.startsWith(dropdownPrefix)) {
        this.bundleState.removeBundleItem(itemKey);
        break; // Only one item per dropdown
      }
    }
  }

  handleStateChange(changeType) {
    if (changeType === "bundleItems") {
      // Update dropdown selection based on bundle state if needed
      this.syncDropdownWithBundleState();
    }
  }

  syncDropdownWithBundleState() {
    // Check if there's an item in the bundle for this dropdown
    const bundleItems = this.bundleState.bundleItems;
    const dropdownPrefix = `dropdown_${this.dropdownIndex}_`;

    let foundItem = null;
    for (const itemKey in bundleItems) {
      if (itemKey.startsWith(dropdownPrefix)) {
        foundItem = bundleItems[itemKey];
        break;
      }
    }

    if (foundItem) {
      // Set the dropdown to the correct variant
      this.select.value = foundItem.variantId;
    } else {
      // Reset dropdown to empty
      this.select.value = "";
    }
  }
}

customElements.define("fsb-product-dropdown", FsbProductDropdown);

/**
 * Dropdown group component
 * Manages the group of three dropdowns
 */
class FsbDropdownGroup extends HTMLElement {
  constructor() {
    super();
    this.dropdowns = [];
    this.bundleState = null;
  }

  connectedCallback() {
    this.dropdowns = this.querySelectorAll("fsb-product-dropdown");

    // Initialize bundle state
    BundleStateManager.initBundleState.call(this);
    this.bundleState.subscribe(this, this.handleStateChange.bind(this));
  }

  disconnectedCallback() {
    if (this.bundleState) {
      this.bundleState.unsubscribe(this);
    }
  }

  handleStateChange(changeType) {
    if (changeType === "bundleItems") {
      // Update the add to cart button state based on bundle count
      this.updateAddToCartButton();
    }
  }

  updateAddToCartButton() {
    const addToCartButton = document.querySelector(".js-addToCart");
    if (addToCartButton) {
      // Enable button only when exactly 3 items are selected
      const itemCount = Object.keys(this.bundleState.bundleItems).length;
      addToCartButton.disabled = itemCount !== 3;
      if (itemCount !== 3) {
        addToCartButton.innerText = "Select All Items to Add";
      } else {
        addToCartButton.innerText = "Add to Cart";
      }
    }
  }
}

customElements.define("fsb-dropdown-group", FsbDropdownGroup);

class FsbDropdownGroup5 extends HTMLElement {
  constructor() {
    super();
    this.dropdowns = [];
    this.bundleState = null;
  }

  connectedCallback() {
    this.dropdowns = this.querySelectorAll("fsb-product-dropdown");

    // Initialize bundle state
    BundleStateManager.initBundleState.call(this);
    this.bundleState.subscribe(this, this.handleStateChange.bind(this));
  }

  disconnectedCallback() {
    if (this.bundleState) {
      this.bundleState.unsubscribe(this);
    }
  }

  handleStateChange(changeType) {
    if (changeType === "bundleItems") {
      // Update the add to cart button state based on bundle count
      this.updateAddToCartButton();
    }
  }

  updateAddToCartButton() {
    const addToCartButton = document.querySelector(".js-addToCart");
    if (addToCartButton) {
      const itemCount = Object.keys(this.bundleState.bundleItems).length;
      addToCartButton.disabled = itemCount !== 5;
      if (itemCount !== 5) {
        addToCartButton.innerText = "Select All Items to Add";
      } else {
        addToCartButton.innerText = "Add to Cart";
      }
    }
  }
}

customElements.define("fsb-dropdown-group-5", FsbDropdownGroup5);
