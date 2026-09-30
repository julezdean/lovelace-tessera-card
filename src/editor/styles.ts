export const EDITOR_STYLES = `
:host { display: block; }

.conditions { margin-top: 18px; }
.conditions .heading { margin-bottom: 6px; }

.note {
  margin: 4px 4px 0;
  font-size: 12px;
  line-height: 1.45;
  color: var(--secondary-text-color);
}

ha-form { display: block; }

.list { margin-top: 18px; }

.heading {
  font-size: 15px;
  font-weight: 500;
  margin: 0 0 8px 4px;
  color: var(--primary-text-color);
}

.row {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 4px 4px 4px 10px;
  border: 1px solid var(--divider-color, rgba(127, 127, 127, 0.3));
  border-radius: 10px;
  margin-bottom: 6px;
  background: var(--card-background-color);
}

.row-icon {
  flex: 0 0 auto;
  display: flex;
  align-items: center;
  justify-content: center;
  width: 22px;
  height: 22px;
  color: var(--secondary-text-color);
  --mdc-icon-size: 22px;
}

.row-label {
  flex: 1 1 auto;
  min-width: 0;
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 1px;
  background: none;
  border: 0;
  padding: 6px 4px;
  cursor: pointer;
  font-family: inherit;
  text-align: left;
  color: inherit;
}
.row-label:hover .row-name { text-decoration: underline; }

.row-name {
  font-size: 14px;
  color: var(--primary-text-color);
  max-width: 100%;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.row-entity {
  font-size: 12px;
  color: var(--secondary-text-color);
  max-width: 100%;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.row-actions {
  flex: 0 0 auto;
  display: flex;
  align-items: center;
  --mdc-icon-button-size: 36px;
  --mdc-icon-size: 20px;
  color: var(--secondary-text-color);
}
.row-actions ha-icon-button[disabled] { opacity: 0.3; pointer-events: none; }
.row-actions ha-icon,
.header ha-icon {
  display: flex;
  width: 20px;
  height: 20px;
  cursor: pointer;
}

.add {
  width: 100%;
  margin-top: 4px;
  padding: 10px;
  border: 1px dashed var(--divider-color, rgba(127, 127, 127, 0.4));
  border-radius: 10px;
  background: none;
  color: var(--primary-color);
  font-family: inherit;
  font-size: 14px;
  cursor: pointer;
}
.add:hover { background: rgba(127, 127, 127, 0.08); }

/* The type chooser under "+ Add item". */
.chooser {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(120px, 1fr));
  gap: 6px;
  margin-top: 6px;
}
.choice {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 10px;
  border: 1px solid var(--divider-color, rgba(127, 127, 127, 0.3));
  border-radius: 10px;
  background: var(--card-background-color);
  color: var(--primary-text-color);
  font-family: inherit;
  font-size: 14px;
  cursor: pointer;
  --mdc-icon-size: 20px;
}
.choice:hover { background: rgba(127, 127, 127, 0.08); }

.empty {
  font-size: 13px;
  color: var(--error-color, #ff5f56);
  margin: 0 0 8px 4px;
}

.header {
  display: flex;
  align-items: center;
  gap: 4px;
  margin-bottom: 8px;
  --mdc-icon-button-size: 40px;
  --mdc-icon-size: 22px;
  color: var(--primary-text-color);
}

.header .yaml-toggle { margin-left: auto; }

.yaml { margin-top: 4px; }
.type-form { display: block; margin-bottom: 8px; }
.yaml ha-yaml-editor { display: block; }

.header-title {
  font-size: 16px;
  font-weight: 500;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
`;
