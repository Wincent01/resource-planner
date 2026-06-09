
///////////////////////////////////////////////////////////////////////////////////////////////////
// Global state: server-side data & auth

let CURRENT_DATASET_ID = null;
let CURRENT_USER = null;
let DATA_CACHE = { periods: [], roles: {}, tasks: {} };


function apiCall(method, path, body, { silent = false } = {}) {
    const opts = {
        method,
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
    };
    if (body !== undefined) opts.body = JSON.stringify(body);
    return fetch(path, opts).then(r => {
        if (!r.ok) return r.json().then(d => { throw new Error(d.error || r.statusText); });
        return r.json();
    }).catch(err => {
        console.error('API error:', err);
        if (!silent) alert('Server error: ' + err.message);
        throw err;
    });
}


async function checkAuth() {
    try {
        const resp = await apiCall('GET', '/api/auth/me', undefined, { silent: true });
        CURRENT_USER = resp.user;
        return resp.user;
    } catch {
        return null;
    }
}


function showLoginModal() {
    const dialog = document.querySelector('#auth-dialog');
    const loginTab = dialog.querySelector('#auth-login');
    const registerTab = dialog.querySelector('#auth-register');
    const errorElem = dialog.querySelector('.auth-error');
    const form = dialog.querySelector('form');

    // Reset state
    loginTab.style.display = 'block';
    registerTab.style.display = 'none';
    errorElem.textContent = '';
    form.reset();

    // Tab switching
    dialog.querySelectorAll('.auth-tabs button').forEach(btn => {
        btn.addEventListener('click', (e) => {
            e.preventDefault();
            const showLogin = btn.value === 'login';
            loginTab.style.display = showLogin ? 'block' : 'none';
            registerTab.style.display = showLogin ? 'none' : 'block';
            errorElem.textContent = '';
            dialog.querySelectorAll('.auth-tabs button').forEach(b => b.classList.toggle('active', b === btn));
        });
    });

    dialog.showModal();

    return new Promise((resolve) => {
        function handleClose() {
            if (dialog.returnValue === 'login-submit' || dialog.returnValue === 'register-submit') {
                const isRegister = dialog.returnValue === 'register-submit';
                const username = (isRegister
                    ? form.elements['reg-username']?.value
                    : form.elements['username'].value).trim();
                const password = isRegister
                    ? form.elements['reg-password']?.value
                    : form.elements['password'].value;

                if (!username || !password) {
                    errorElem.textContent = 'All fields are required.';
                    dialog.showModal();
                    return;
                }

                if (isRegister) {
                    const confirmPassword = form.elements['reg-confirm-password']?.value;
                    if (password !== confirmPassword) {
                        errorElem.textContent = 'Passwords do not match.';
                        dialog.showModal();
                        return;
                    }
                    if (password.length < 4) {
                        errorElem.textContent = 'Password must be at least 4 characters.';
                        dialog.showModal();
                        return;
                    }
                }

                const endpoint = isRegister ? 'register' : 'login';

                apiCall('POST', '/api/auth/' + endpoint, { username, password })
                    .then(resp => {
                        CURRENT_USER = resp.user;
                        dialog.removeEventListener('close', handleClose);
                        dialog.close();
                        resolve(resp.user);
                    })
                    .catch(err => {
                        errorElem.textContent = err.message;
                        dialog.showModal();
                    });
                return;
            }
            // If dialog was closed without submitting, open it again
            if (!CURRENT_USER) {
                dialog.showModal();
            } else {
                resolve(null);
            }
        }
        dialog.addEventListener('close', handleClose);
    });
}


function getDatasetIdFromUrl() {
    const params = new URLSearchParams(window.location.search);
    return params.get('dataset') || null;
}


function setDatasetIdInUrl(datasetId) {
    const params = new URLSearchParams(window.location.search);
    params.set('dataset', datasetId);
    window.location.search = params.toString();
}


async function fetchDatasets() {
    const resp = await apiCall('GET', '/api/datasets');
    return resp.datasets || [];
}


async function loadDatasetData(datasetId) {
    const data = await apiCall('GET', '/api/datasets/' + datasetId + '/data');
    DATA_CACHE = data;
}


window.addEventListener("DOMContentLoaded", async () => {
    // Ensure user is authenticated
    if (!await checkAuth()) {
        await showLoginModal();
    }
    if (!CURRENT_USER) window.location.reload();

    // Load or create dataset
    let datasetId = getDatasetIdFromUrl();
    const datasets = await fetchDatasets();

    if (datasetId) {
        // Verify access
        const found = datasets.find(d => d.id === parseInt(datasetId));
        if (!found) datasetId = null;
    }

    if (!datasetId && datasets.length > 0) {
        datasetId = String(datasets[0].id);
    }

    if (!datasetId) {
        // No datasets — create one
        const resp = await apiCall('POST', '/api/datasets', { name: 'My Schedule' });
        datasetId = String(resp.dataset.id);
        // Refresh dataset list so the selector shows the new dataset
        const updated = await fetchDatasets();
        datasets.length = 0;
        datasets.push(...updated);
    }

    CURRENT_DATASET_ID = parseInt(datasetId);
    await loadDatasetData(CURRENT_DATASET_ID);

    // Now populate the page
    setupDatasetSelector(datasets);
    setupShareDialog();
    setupLogoutButton();
    setupImportExport();
    setupAddRole();
    setupPeriods();
    selectPeriod();
});


///////////////////////////////////////////////////////////////////////////////////////////////////
// Handling periods

function setupPeriods() {
    const periods = dbGetPeriods();
    for (const roleId of dbRoleIds())
        for (p in dbGetRole(roleId).target)
            if (!periods.includes(p)) {
                console.warn(`Database doesn't list period ${p}, adding it.`);
                dbInsertPeriod(p);
            }
    const periodSelect = document.querySelector("#select-period select");
    for (const period of periods) {
        periodSelect.appendChild(newElem("option", period, {value: period}));
    }
    periodSelect.appendChild(newElem("option", "Summary", {value: ""}));
    periodSelect.appendChild(newElem("option", "────────────────────", {value: "%", disabled: true}));
    periodSelect.appendChild(newElem("option", "Add new empty period", {value: "+"}));
    if (getCurrentPeriod()) {
        periodSelect.appendChild(newElem("option", "Clone this period", {value: "="}));
        periodSelect.appendChild(newElem("option", "Rename this period", {value: "/"}));
        periodSelect.appendChild(newElem("option", "Delete this period", {value: "-"}));
    }
    periodSelect.addEventListener("change", (event) => {
        const currentPeriod = getCurrentPeriod();
        if (dbGetPeriods().includes(periodSelect.value) || !periodSelect.value) {
            setNewPeriod(periodSelect.value);
            return;
        } else if (periodSelect.value === "/") {
            const newPeriod = prompt("What is the new name of the period?");
            if (newPeriod && !dbGetPeriods().includes(newPeriod)) {
                renamePeriod(currentPeriod, newPeriod);
                const option = periodSelect.querySelector(`option[value="${currentPeriod}"]`);
                option.value = option.textContent = newPeriod;
                setNewPeriod(newPeriod);
                return;
            } else if (newPeriod) {
                alert(`The period ${newPeriod} already exists.`);
            }
        } else if (periodSelect.value === "+" || periodSelect.value === "=") {
            const newPeriod = prompt("What is the name of the new period?");
            if (newPeriod) {
                dbInsertPeriod(newPeriod);
                periodSelect.insertBefore(newElem("option", newPeriod, {value: newPeriod}), periodSelect.childNodes[0]);
                if (periodSelect.value === "=") {
                    clonePeriod(currentPeriod, newPeriod);
                }
                setNewPeriod(newPeriod);
                return;
            }
        } else if (periodSelect.value === "-") {
            if (prompt(`Are you sure you want to delete ${currentPeriod}?\nIf so, type "YES":`) === "YES") {
                deletePeriod(currentPeriod);
                periodSelect.querySelector(`option[value="${currentPeriod}"]`).remove();
                setNewPeriod("");
                return;
            }
        }
        option = periodSelect.querySelector(`option[value="${currentPeriod}"]`).selected = true;
    });
}


function selectPeriod() {
    const periodSelect = document.querySelector("#select-period select");
    const period = getCurrentPeriod();
    const periodOption = periodSelect.querySelector(`option[value="${period}"]`);
    periodOption.selected = true;
    document.querySelector("#current-period").textContent = periodOption.textContent;
    if (!period) document.querySelector("body").classList.add("summary-all-periods");
    populateRolesAndTasks();
}


function setNewPeriod(period) {
    const params = new URLSearchParams(window.location.search);
    if (period) {
        params.set('period', period.replaceAll(" ", "+"));
    } else {
        params.delete('period');
    }
    window.location.search = params.toString();
}


function getCurrentPeriod() {
    const params = new URLSearchParams(window.location.search);
    const period = (params.get('period') || '').replaceAll("+", " ");
    return dbGetPeriods().includes(period) ? period : "";
}


function renamePeriod(oldPeriod, newPeriod) {
    for (const roleId of dbRoleIds()) {
        const role = dbGetRole(roleId);
        if (oldPeriod in role.target) {
            role.target[newPeriod] = role.target[oldPeriod];
            delete role.target[oldPeriod];
            dbUpdateRole(roleId, role);
        }
    }
    for (const taskId of dbTaskIds()) {
        const task = dbGetTask(taskId);
        if (task.period === oldPeriod) {
            task.period = newPeriod;
            dbUpdateTask(taskId, task);
        }
    }
    const periods = dbGetPeriods();
    const i = periods.indexOf(oldPeriod);
    periods[i] = newPeriod;
    dbSetPeriods(periods);
}


function deletePeriod(period) {
    for (const roleId of dbRoleIds()) {
        const role = dbGetRole(roleId);
        if (period in role.target) {
            delete role.target[period];
            if (Object.keys(role.target).length > 0) {
                dbUpdateRole(roleId, role);
            } else {
                dbDeleteRole(roleId);
            }
        }
    }
    for (const taskId of dbTaskIds()) {
        const task = dbGetTask(taskId);
        if (task.period === period) {
            dbDeleteTask(taskId);
        }
    }
    dbDeletePeriod(period);
}


function clonePeriod(fromPeriod, toPeriod) {
    for (const roleId of dbRoleIds()) {
        const role = dbGetRole(roleId);
        if (fromPeriod in role.target) {
            role.target[toPeriod] = role.target[fromPeriod];
        } else if (toPeriod in role.target) {
            delete role.target[toPeriod];
        } else {
            continue;
        }
        dbUpdateRole(roleId, role);
    }
    for (const taskId of dbTaskIds()) {
        if (dbGetTask(taskId).period === toPeriod) dbDeleteTask(taskId);
    }
    for (const taskId of dbTaskIds()) {
        const task = dbGetTask(taskId);
        if (task.period === fromPeriod) {
            const newTaskId = dbCreateTask(task);
            task.period = toPeriod;
            dbUpdateTask(newTaskId, task);
        }
    }
    dbInsertPeriod(toPeriod);
}


///////////////////////////////////////////////////////////////////////////////////////////////////
// Import, export

function setupImportExport() {
    const importJSONElem = document.querySelector('#import-json input[type="file"]');
    importJSONElem.addEventListener("change", importJSON);
    document.querySelector("#import-json button").addEventListener("click", () => importJSONElem.click());
    const exportJSONElem = document.querySelector("#export-json button");
    exportJSONElem.addEventListener("click", exportJSON);
    exportJSONElem.value = `Export data to "${SETTINGS.exportFileName}.json"`
    const exportCSVElem = document.querySelector("#export-csv button");
    exportCSVElem.addEventListener("click", exportCSV);
    exportCSVElem.value = `Export data to "${SETTINGS.exportFileName}.csv"`
}


function exportJSON() {
    const text = JSON.stringify(dbGetAllData(), null, 4);
    const href = "data:text/plain;charset=utf-8," + encodeURIComponent(text);
    let elem = newElem("a", {href: href, download: SETTINGS.exportFileName+".json", style: "display:none"});
    document.body.appendChild(elem);
    elem.click();
    document.body.removeChild(elem);
}


function importJSON() {
    const fileInput = document.querySelector("#import-json input");
    const fileReader = new FileReader();
    fileReader.onload = async (e) => {
        const content = e.target.result;
        await dbReplaceAllData(JSON.parse(content));
        window.location.reload();
    };
    fileReader.readAsText(fileInput.files[0]);
}


function exportCSV() {
    const taskIds = dbTaskIds();
    const someTask = dbGetTask(taskIds[0]);
    const roleNames = Object.keys(someTask.roles).toSorted();
    const header = roleNames.flatMap(
        (n) => [n, n + " name", n + " nickname", n + " group", n + " size"]
    ).concat("period", "value");
    function makeRow(task) {
        return roleNames.flatMap((n) => {
            const r = dbGetRole(task.roles[n]);
            return [task.roles[n], r.name, r.nickname || r.name, r.group, r?.size?.[task.period] || 0];
        }).concat(task.period, task.value);
    }
    let text = header.join(";") + "\n";
    for (const id of dbTaskIds()) {
        text += makeRow(dbGetTask(id)).join(";") + "\n";
    }
    const href = "data:text/plain;charset=utf-8," + encodeURIComponent(text);
    let elem = newElem("a", {href: href, download: SETTINGS.exportFileName+".csv", style: "display:none"});
    document.body.appendChild(elem);
    elem.click();
    document.body.removeChild(elem);
}


function cleanTasks() {
    const oldIds = dbTaskIds();
    const oldToNewIds = {}
    oldIds.forEach((oldId, newId) => {
        oldToNewIds[oldId] = newId;
    });
    document.querySelectorAll(".task").forEach((taskElem) => {
        taskElem.dataset.taskId = oldToNewIds[taskElem.dataset.taskId];
    });
    oldIds.forEach((oldId, newId) => {
        dbUpdateTask(newId, dbGetTask(oldId));
        dbDeleteTask(oldId);
    });
}


///////////////////////////////////////////////////////////////////////////////////////////////////
// Initialise the webpage

function populateRolesAndTasks() {
    for (const containerElem of document.querySelectorAll(".container")) {
        containerElem.replaceChildren();
    }
    const sortedIds = dbRoleIds();
    for (const roleId of sortedIds) {
        populateRole(roleId);
    }
    if (getCurrentPeriod()) {
        populateAddTaskDropdown(sortedIds);
        for (const taskId of dbTaskIds()) {
            populateTask(taskId, true);
        }
    }
    updateRoles();
}


function populateRole(roleId) {
    const role = dbGetRole(roleId);
    const currentPeriod = getCurrentPeriod();
    if (currentPeriod && role.target[currentPeriod] == null) return;

    const template = document.querySelector(`#${role.type}-template`);
    if (!template) return;
    const roleElem = template.content.cloneNode(true).querySelector("form.role");
    roleElem.dataset.role = roleId;
    if (role.group) roleElem.classList.add(role.group);
    roleElem.elements["name"].value = role.name;
    roleElem.elements["name"].title = (
        (role.nickname || role.name) +
        (role.comments ? "\n\n" + role.comments : "")
    );
    if (role.comments) {
        roleElem.querySelector(".comments").textContent = role.comments;
    }

    // Add the role to the container
    let containerElem;
    if (role.group) containerElem = document.querySelector(`.container[data-type="${role.type}"][data-group="${role.group}"]`);
    if (!containerElem) containerElem = document.querySelector(`.container[data-type="${role.type}"]`);
    containerElem.append(roleElem);

    // The summary page: show only the role summaries, and nothing should be possible to edit
    if (!currentPeriod) {
        const detailsElem = roleElem.querySelector("details");
        detailsElem.removeAttribute("open");
        detailsElem.setAttribute("disabled", "");
        for (const inputElem of detailsElem.querySelectorAll("input, select")) {
            inputElem.setAttribute("disabled", "");
        }
        return;
    }

    // Edit the role
    roleElem.querySelector(".edit-role")?.addEventListener("click", editRole);

    // Show a summary
    roleElem.querySelector(".info-role")?.addEventListener("click", showSummary)

    // Drag and drop
    setupDraggableRole(roleElem, role.type);

    // Changing the total target value of a role
    const totalElem = roleElem.elements["total-value"];
    totalElem.addEventListener("change", (event) => {
        role.target[currentPeriod] = totalElem.value = parseInt(totalElem.value) || 0;
        dbUpdateRole(roleId, role);
        updateRoles(roleElem);
        totalElem.blur();
    });

    // The extra information "size"
    const sizeElem = roleElem.elements["size"];
    if (sizeElem) {
        sizeElem.addEventListener("change", (event) => {
            if (!role.size) role.size = {};
            const size = parseInt(sizeElem.value);
            role.size[currentPeriod] = size || 0;
            sizeElem.value = size || "";
            dbUpdateRole(roleId, role);
            updateRoles(roleElem);
            sizeElem.blur();
        })
    }

    const detailsElem = roleElem.querySelector("details");
    detailsElem.toggleAttribute("open", role.open);

    detailsElem.addEventListener("toggle", (event) => {
        const open = detailsElem.hasAttribute("open");
        role.open = open;
        dbUpdateRole(roleId, role);
    });

    // Alt-click to open/close all siblings
    detailsElem.addEventListener("click", (event) => {
        if (event.altKey) {
            event.preventDefault();
            const open = !detailsElem.hasAttribute("open");
            for (const elem of roleElem.closest(".container").querySelectorAll("form.role")) {
                elem.querySelector("details").toggleAttribute("open", open);
                const id = elem.dataset.role;
                const role = dbGetRole(id);
                role.open = open;
                dbUpdateRole(id, role);
            }
        }
    });
}


function populateAddTaskDropdown(sortedIds) {
    // TODO: This only works if there are two types.
    // If there are more, then the new tasks will miss to include a role.
    const currentPeriod = getCurrentPeriod();
    for (const addElem of document.querySelectorAll(`select.add-task`)) {
        addElem.replaceChildren();
        addElem.appendChild(newElem("option", "+", {disabled: true, selected: true}));
        for (const roleId of sortedIds) {
            const role = dbGetRole(roleId);
            if (currentPeriod in role.target) {
                if (addElem.name === role.group || addElem.name === role.type) {
                    addElem.appendChild(newElem("option", role.name, {value: role.type + ":" + roleId}));
                }
            }
        }

        const otherId = addElem.closest("form.role").dataset.role;
        const other = dbGetRole(otherId);
        const newValue = SETTINGS.newTaskValue[other.group] || SETTINGS.newTaskValue[other.type];
        addElem.addEventListener("change", (event) => {
            const [roleType, roleId] = addElem.value.split(":");
            const task = {
                roles: {
                    [roleType]: roleId,
                    [other.type]: otherId,
                },
                period: getCurrentPeriod(),
                value: newValue,
            };
            const taskId = dbCreateTask(task);
            populateTask(taskId);
            addElem.selectedIndex = 0;
            addElem.blur();
        })
    }
}


function populateTask(taskId, dontUpdateRoles = false) {
    const currentPeriod = getCurrentPeriod();
    const task = dbGetTask(taskId);
    if (task.period !== currentPeriod) return;
    const roleElems = {};
    const taskListSelectors = [];
    for (const type in task.roles) {
        const roleElem = document.querySelector(`.role[data-role="${task.roles[type]}"]`);
        if (!roleElem) continue;
        roleElems[type] = roleElem;
        const group = dbGetRole(roleElem.dataset.role).group;
        if (group) taskListSelectors.push(`.${group} > .tasklist`);
    }
    taskListSelectors.push(".tasklist"); // Catch-all, if no group tasklist is found below

    for (const type in roleElems) {
        const taskElem = newElem(
            "div", {class: "task", draggable: "true"},
            newElem("span", {class: "task-value"}),
            newElem("span", {class: "task-info"}),
        );

        taskElem.dataset.taskId = taskId;

        let tasklistElem, tasklistSelector;
        for (tasklistSelector of taskListSelectors) {
            tasklistElem = roleElems[type].querySelector(tasklistSelector);
            if (tasklistElem) break;
        }
        tasklistElem.append(taskElem);

        // Editing, removing
        taskElem.addEventListener("dblclick", editTask);
        // taskElem.addEventListener("contextmenu", editTask);

        // Drag and drop
        setupDraggableTask(taskElem, type, tasklistSelector);

        // Resizing
        new ResizeObserver(debounce((entries) => {
            for (const entry of entries) {
                if (entry.target !== taskElem) continue;
                const width = entry.contentRect.width;
                if (width && width > 0) {
                    const newValue = widthToValue(width);
                    if (newValue !== task.value) {
                        task.value = newValue;
                        dbUpdateTask(taskId, task);
                        updateTask(taskId, true);
                    }
                }
                updateRoles(...Object.values(roleElems));
            }
        })).observe(taskElem);
    }

    updateTask(taskId);
    if (!dontUpdateRoles)
        updateRoles(...Object.values(roleElems));
}


///////////////////////////////////////////////////////////////////////////////////////////////////
// Handling tasks

function deleteTask(taskId) {
    const roleElems = [];
    for (const taskElem of document.querySelectorAll(`.task[data-task-id="${taskId}"]`)) {
        roleElems.push(taskElem.closest("form.role"));
        taskElem.remove();
    }
    updateRoles(...roleElems);
    dbDeleteTask(taskId);
}


function editTask(event) {
    event.preventDefault();
    const taskElem = event.target.closest(".task");
    showTaskEditor(taskElem);
}


function showTaskEditor(taskElem) {
    const taskId = taskElem.dataset.taskId;
    const task = dbGetTask(taskId);
    const taskInfo = taskElem.querySelector(".task-info").textContent;

    const taskEditor = document.querySelector("#edit-task-dialog");
    taskEditor.querySelector(".edit-task-id").textContent = taskId;

    const form = taskEditor.querySelector("form");
    form.querySelectorAll("select").forEach((elem) => elem.replaceChildren());
    for (const roleId of dbRoleIds()) {
        const role = dbGetRole(roleId);
        const selectElem = form.elements[role.type];
        selectElem.appendChild(
            newElem("option", role.name, {value: roleId})
        );
        if (task.roles[role.type] === roleId) selectElem.lastChild.selected = true;
    }
    form.elements.value.value = task.value || 0;
    form.elements.comments.value = task.comments || "";

    function handleEdits() {
        if (taskEditor.returnValue === "ok") {
            const updated = {
                value: parseFloat(form.elements.value.value),
                comments: form.elements.comments.value,
                period: task.period,
                roles: {},
            };
            for (const type in task.roles) {
                updated.roles[type] = form.elements[type].value;
            }
            if (JSON.stringify(updated) !== JSON.stringify(task)) {
                dbUpdateTask(taskId, updated);
                populateRolesAndTasks();
            }
        } else if (taskEditor.returnValue === "delete") {
            if (confirm(`Do you want to delete the task "${taskInfo}"?`)) {
                deleteTask(taskElem.dataset.taskId);
            }
        }
    }
    taskEditor.addEventListener("close", handleEdits, {once: true});
    taskEditor.showModal();
}


function updateTask(taskId, dontReorder) {
    const task = dbGetTask(taskId);
    if (!task) return;
    const taskElems = document.querySelectorAll(`.task[data-task-id="${taskId}"]`);
    for (const taskElem of taskElems) {
        const roleId = taskElem.closest("form.role").dataset.role;
        const taskRoles = Object.keys(task.roles).flatMap((type) =>
            (task.roles[type] !== roleId) ? dbGetRole(task.roles[type]) : []
        );
        if (taskRoles.length === 0) console.warn(`Task ${taskId} in ${roleId}: empty description`, task);
        const taskInfo = taskRoles.map((r) => r.nickname || r.name).join(" + ");
        taskElem.querySelector(".task-value").textContent = task.value;
        taskElem.querySelector(".task-info").textContent = taskInfo;
        taskElem.title = (
            task.value + ": " + taskRoles.map((r) => r.name).join(" + ") +
            (task.comments ? "\n\n" + task.comments : "")
        );
        const width = valueToWidth(task.value);
        taskElem.style.width = width + "px";
        if (!dontReorder) {
            const taskParent = taskElem.parentNode;
            for (const otherTask of taskParent.querySelectorAll(".task")) {
                if (taskInfo.localeCompare(otherTask.querySelector(".task-info").textContent) < 0) {
                    taskParent.insertBefore(taskElem, otherTask);
                    break;
                }
            }
        }
    }
}


///////////////////////////////////////////////////////////////////////////////////////////////////
// Handling roles

function setupAddRole() {
    for (const elem of document.querySelectorAll("select.add-role")) {
        const type = elem.dataset.type;
        for (const roleId of dbRoleIds()) {
            const role = dbGetRole(roleId);
            if (role.type === type) {
                let optgroup = elem.querySelector(`optgroup[data-group="${role.group}"]`);
                if (!optgroup) optgroup = elem;
                optgroup.appendChild(newElem("option", role.name, {value: roleId}));
            }
        }
        elem.selectedIndex = 0;
        elem.addEventListener("focus", filterAddSelect);
        elem.addEventListener("change", addNewRole);
    }
}


function filterAddSelect(event) {
    const selectElem = event.target;
    for (const optElem of selectElem.querySelectorAll("option")) {
        const roleId = optElem.value;
        optElem.style.display = document.querySelector(`.role[data-role="${roleId}"]`) ? "none" : "inherit";
    }
}


function addNewRole(event) {
    const selectElem = event.target;
    if (selectElem.value === "+") {
        const roleId = "role-" + Math.floor((Math.random() + 1) * 1e10).toString(36);
        showRoleEditor(roleId, {type: selectElem.dataset.type, target: {}});
    } else {
        const roleId = selectElem.value;
        const role = dbGetRole(roleId);
        const currentPeriod = getCurrentPeriod();
        if (role.target[currentPeriod] != null) {
            console.error(`New role ${roleId} already contains the current period.`);
            return;
        }
        const newTarget = SETTINGS.newRoleValue[role.group] || SETTINGS.newRoleValue[role.type];
        role.target[currentPeriod] = newTarget;
        dbUpdateRole(roleId, role);
        populateRolesAndTasks();
    }
    selectElem.selectedIndex = 0;
    selectElem.blur();
}


function editRole(event) {
    event.preventDefault();
    event.stopPropagation();
    const roleId = event.target.closest("form.role").dataset.role;
    showRoleEditor(roleId, dbGetRole(roleId));
}


function showRoleEditor(roleId, role) {
    const roleEditor = document.querySelector(`#edit-dialog-${role.type}`);
    roleEditor.querySelector(".edit-role-id").textContent = roleId;
    const period = getCurrentPeriod();

    const form = roleEditor.querySelector("form");
    form.elements.name.value = role.name || "";
    form.elements.nickname.value = role.nickname || "";
    form.elements.group.value = role.group || "";
    form.elements.comments.value = role.comments || "";
    form.elements.target.value = role.target[period] || 0;
    if (form.elements.size) {
        form.elements.size.value = role.size?.[period] || 0;
    }

    function handleEdits() {
        if (roleEditor.returnValue === "ok") {
            const newTarget = parseFloat(form.elements.target.value);
            const updated = {
                type: role.type,
                name: form.elements.name.value,
                nickname: form.elements.nickname.value,
                group: form.elements.group.value,
                comments: form.elements.comments.value,
                target: Object.assign({}, role.target, {[period]: newTarget}),
            };
            if (form.elements.size) {
                const newSize = parseFloat(form.elements.size.value);
                updated.size = Object.assign({}, role.size, {[period]: newSize});
            }
            if (JSON.stringify(updated) !== JSON.stringify(role)) {
                dbUpdateRole(roleId, updated);
                populateRolesAndTasks();
                document.querySelector(`.role[data-role="${roleId}"]`).scrollIntoView({block: "center", inline: "center"});
            }
        } else if (roleEditor.returnValue === "delete") {
            const populated = dbTaskIds().some((id) => {
                const task = dbGetTask(id);
                return task.period === period && task.roles[role.type] === roleId;
            });
            if (populated) {
                alert("You have to remove all tasks before you can remove the role");
            } else if (confirm(`Are you certain you want to remove role ${role.name}?`)) {
                delete role.target[period];
                if (Object.keys(role.target).length === 0) {
                dbDeleteRole(roleId);
                } else {
                    dbUpdateRole(roleId, role);
                }
                populateRolesAndTasks();
            }
        }
    }
    roleEditor.addEventListener("close", handleEdits, {once: true});
    roleEditor.showModal();
}


function updateRoles(...roleElems) {
    const period = getCurrentPeriod();
    if (roleElems.length === 0)
        roleElems = document.querySelectorAll("form.role");
    for (const roleElem of roleElems) {
        const roleId = roleElem.dataset.role;
        const role = dbGetRole(roleId);
        if (!role) continue;
        const totalElem = roleElem.elements["total-value"];
        const totalValue = period ? role.target[period] : sum(Object.values(role.target));
        totalElem.value = totalValue;
        const usedValueElem = roleElem.elements["used-value-text"];
        const usedSliderElem = roleElem.elements["used-value-slider"];
        const usedValue = sum(dbTaskIds().map((id) => {
            const task = dbGetTask(id);
            return (!period || task?.period === period) && (task?.roles?.[role.type] === roleId) ? task.value : 0;
        }));
        usedSliderElem.style.width = usedValueSliderWidth(usedValue, totalValue) + "%";
        usedSliderElem.textContent = displaySign(Math.round(usedValue - totalValue));
        usedValueElem.textContent = usedValue;
        const sizeElem = roleElem.elements["size"];
        if (sizeElem) {
            const size = !role.size ? null : period ? role.size[period] : sum(Object.values(role.size));
            sizeElem.value = size || "";
        }
        const calcElem = roleElem.elements["calculated"];
        if (calcElem){
            calcElem.value = calculateValue(role, period);
        }
    }
}


function calculateValue(role, period) {
    const calcFun = SETTINGS.calculation?.[role.type];
    const postValue = SETTINGS.valueDescriptor?.[role.type] || "";
    let calculated;
    try { calculated = calcFun(role, period);
    } catch {}
    return calculated ? ` → ${calculated}${postValue}` : "";
}


function showSummary(event) {
    event.preventDefault();
    event.stopPropagation();
    const roleId = event.target.closest("form.role").dataset.role;
    const data = dbGetAllData();
    const role = data.roles[roleId];
    const roleTasks = {};
    let totalValue = 0;
    for (const taskId in data.tasks) {
        const task = data.tasks[taskId];
        if (task.roles[role.type] !== roleId) continue;
        let taskRole;
        for (const type in task.roles) {
            if (type !== role.type) {
                taskRole = data.roles[task.roles[type]];
                break;
            }
        }
        if (!taskRole) {
            console.error("MISSING ROLE", roleId, taskId, task);
            continue;
        }
        const key = `${task.period}: ${taskRole.group}`;
        if (!roleTasks[key]) roleTasks[key] = [];
        let title = taskRole.name;
        if (task.comments) title += "  [" + task.comments.replace("\n", " // ") + "]";
        roleTasks[key].push({title: title, value: task.value});
        totalValue += task.value;
    }

    const summaryModal = document.querySelector("#role-info-dialog");
    const content = summaryModal.querySelector(".role-info-content");
    content.innerHTML = "";
    const postSize = SETTINGS.sizeDescriptor?.[role.type] || "";
    const postValue = SETTINGS.valueDescriptor?.[role.type] || "";
    const size = sum(Object.values(role.size));
    content.appendChild(newElem("h2", `${role.name} (${size}${postSize}${calculateValue(role)})`));
    if (role.comments?.trim()) content.appendChild(newElem("p")).innerHTML = role.comments.trim().replace("\n", "<br>");
    const totalTarget = sum(Object.values(role.target));
    content.appendChild(newElem("h3", "Total for all periods"));
    content.appendChild(newElem("ul")).appendChild(newElem("li", `${totalValue}${postValue} (out of ${totalTarget}${postValue})`));
    for (const key of Object.keys(roleTasks).toSorted()) {
        const valueSum = sum(roleTasks[key].map((task) => task.value));
        content.appendChild(newElem("h3", `${key} (${valueSum}${postValue})`));
        const list = content.appendChild(newElem("ul"));
        for (const task of roleTasks[key]) {
            list.appendChild(newElem("li", `${task.value}${postValue}: ${task.title}`));
        }
    }
    summaryModal.showModal();
}



///////////////////////////////////////////////////////////////////////////////////////////////////
// Drag and drop

const DRAG_DROP_DATA = {type: null, tasklistSelector: null};


function setupDraggableTask(taskElem, type, tasklistSelector) {
    // Dragging
    taskElem.addEventListener("dragstart", (event) => {
        taskElem.classList.add("dragged");
        event.dataTransfer.effectAllowed = "move";
        // Only allow dragging within the same type
        DRAG_DROP_DATA.type = type;
        DRAG_DROP_DATA.tasklistSelector = tasklistSelector;
    });
    taskElem.addEventListener("dragend", (event) => {
        taskElem.classList.remove("dragged");
    });
}


function setupDraggableRole(roleElem, type) {
    roleElem.addEventListener("dragover", (event) => {
        // Only allow dragging within the same type
        if (DRAG_DROP_DATA.type !== type) return;
        movePlaceholder(event);
    });
    roleElem.addEventListener("dragleave", (event) => {
        // If we are moving into a child element, we aren't actually leaving the column
        if (roleElem.contains(event.relatedTarget)) return;
        const placeholderElem = document.querySelector(".placeholder");
        placeholderElem?.remove();
    });
    roleElem.addEventListener("drop", (event) => {
        event.preventDefault();
        const draggedElem = document.querySelector(".dragged");
        const placeholderElem = document.querySelector(".placeholder");
        if (!placeholderElem) return;
        const oldRoleElem = draggedElem.closest("form.role");
        draggedElem.remove();
        const tasklistSelector = DRAG_DROP_DATA.tasklistSelector;
        roleElem.querySelector(tasklistSelector).insertBefore(draggedElem, placeholderElem);
        placeholderElem.remove();
        const newRoleElem = draggedElem.closest("form.role");
        const roleId = newRoleElem.dataset.role;
        const taskId = draggedElem.dataset.taskId;
        const task = dbGetTask(taskId);
        task.roles[type] = roleId;
        dbUpdateTask(taskId, task);
        updateTask(taskId);
        updateRoles(oldRoleElem, newRoleElem);
        DRAG_DROP_DATA.type = DRAG_DROP_DATA.tasklistSelector = null;
    });

}

function movePlaceholder(event) {
    event.preventDefault();
    const roleElem = event.currentTarget;
    const draggedElem = document.querySelector(".dragged");
    const makePlaceholder = () => newElem(
        "span", draggedElem.textContent, {class: "placeholder", style: `width:${draggedElem.offsetWidth}px`}
    );

    const tasklistSelector = DRAG_DROP_DATA.tasklistSelector;
    if (!tasklistSelector) return;
    const tasklistElem = roleElem.querySelector(tasklistSelector);
    const placeholderElem = roleElem.querySelector(".placeholder");
    if (placeholderElem) {
        const placeholderRect = placeholderElem.getBoundingClientRect();
        if (placeholderRect.left <= event.clientX && event.clientX <= placeholderRect.right)
            return;
    }
    for (const taskElem of tasklistElem.children) {
        if (event.clientX <= taskElem.getBoundingClientRect().right) {
            if (taskElem === placeholderElem) return;
            placeholderElem?.remove();
            if (taskElem === draggedElem || taskElem.previousElementSibling === draggedElem)
                return;
            tasklistElem.insertBefore(
                placeholderElem ?? makePlaceholder(),
                taskElem,
            );
            return;
        }
    }
    placeholderElem?.remove();
    if (tasklistElem.lastElementChild === draggedElem) return;
    tasklistElem.append(placeholderElem ?? makePlaceholder());
}


///////////////////////////////////////////////////////////////////////////////////////////////////
// Utilities

function newElem(tag, ...args) {
    const elem = document.createElement(tag);
    for (const arg of args) {
        if (typeof arg !== "object" || arg instanceof Element) {
            elem.append(arg);
        } else {
            for (const key in arg) elem.setAttribute(key, arg[key]);
        }
    }
    return elem;
}


function debounce(func) {
    const debounceTimeout = 20;
    let timeout;
    return function executedFunction(...args) {
        const later = () => {
            clearTimeout(timeout);
            func(...args);
        };
        clearTimeout(timeout);
        timeout = setTimeout(later, debounceTimeout);
    };
}


function displaySign(number) {
    return (number > 0 ? "+" : number < 0 ? "-" : "±") + Math.abs(number);
}


function sum(array) {
    return array.reduce((sum, val) => sum + parseFloat(val), 0);
}


function valueToWidth(value) {
    const v2w = SETTINGS.valueToWidth;
    return Math.round((value ** v2w.exponent) * v2w.factor + v2w.base);
}

function widthToValue(width) {
    const v2w = SETTINGS.valueToWidth;
    return Math.max(v2w.minValue, snapToGrid(((width - v2w.base) / v2w.factor) ** (1 / v2w.exponent)));
}

function snapToGrid(value) {
    const v2w = SETTINGS.valueToWidth;
    return Math.round(value / v2w.snapDelta) * v2w.snapDelta;
}

function usedValueSliderWidth(usedValue, totalValue) {
    const usedPercent = 50 * (1 + Math.tanh(2 * (usedValue - totalValue) / totalValue));
    return Math.max(0, Math.min(100, usedPercent));
}


///////////////////////////////////////////////////////////////////////////////////////////////////
// Database (synchronous cache backed by async API)

function dbClearDatabase() {
    DATA_CACHE = { periods: [], roles: {}, tasks: {} };
    if (CURRENT_DATASET_ID)
        apiCall('PUT', '/api/datasets/' + CURRENT_DATASET_ID + '/data', DATA_CACHE);
}

function dbReplaceAllData(data) {
    DATA_CACHE = JSON.parse(JSON.stringify(data));  // deep clone
    if (CURRENT_DATASET_ID)
        return apiCall('PUT', '/api/datasets/' + CURRENT_DATASET_ID + '/data', DATA_CACHE);
    return Promise.resolve();
}

function dbGetAllData() {
    return JSON.parse(JSON.stringify(DATA_CACHE));  // deep clone
}

function dbGetPeriods() {
    return DATA_CACHE.periods || [];
}

function dbSetPeriods(periods) {
    DATA_CACHE.periods = periods;
    if (CURRENT_DATASET_ID)
        apiCall('PUT', '/api/datasets/' + CURRENT_DATASET_ID + '/periods', { periods });
}

function dbInsertPeriod(period) {
    const periods = DATA_CACHE.periods || [];
    if (periods.includes(period)) return;
    periods.splice(0, 0, period);
    DATA_CACHE.periods = periods;
    if (CURRENT_DATASET_ID)
        apiCall('POST', '/api/datasets/' + CURRENT_DATASET_ID + '/periods', { name: period });
}

function dbDeletePeriod(period) {
    const periods = DATA_CACHE.periods || [];
    const i = periods.indexOf(period);
    if (i < 0) return;
    periods.splice(i, 1);
    DATA_CACHE.periods = periods;
    if (CURRENT_DATASET_ID)
        apiCall('DELETE', '/api/datasets/' + CURRENT_DATASET_ID + '/periods/' + encodeURIComponent(period));
}

function dbRoleIds() {
    const roles = DATA_CACHE.roles || {};
    const entries = Object.entries(roles).map(([id, role]) => [id, role.name]);
    return entries.toSorted((a, b) => a[1].localeCompare(b[1])).map(a => a[0]);
}

function dbHasRole(roleId) {
    return (DATA_CACHE.roles || {})[roleId] !== undefined;
}

function dbGetRole(roleId) {
    return (DATA_CACHE.roles || {})[roleId] || null;
}

function dbUpdateRole(roleId, role) {
    if (!DATA_CACHE.roles) DATA_CACHE.roles = {};
    DATA_CACHE.roles[roleId] = role;
    if (CURRENT_DATASET_ID)
        apiCall('PUT', '/api/datasets/' + CURRENT_DATASET_ID + '/roles/' + encodeURIComponent(roleId), role);
}

function dbDeleteRole(roleId) {
    delete (DATA_CACHE.roles || {})[roleId];
    if (CURRENT_DATASET_ID)
        apiCall('DELETE', '/api/datasets/' + CURRENT_DATASET_ID + '/roles/' + encodeURIComponent(roleId));
}

function dbTaskIds() {
    const tasks = DATA_CACHE.tasks || {};
    return Object.keys(tasks).map(Number).toSorted((a, b) => a - b);
}

function dbCreateTask(task) {
    if (!DATA_CACHE.tasks) DATA_CACHE.tasks = {};
    const taskId = Math.max(0, ...Object.keys(DATA_CACHE.tasks).map(Number)) + 1;
    DATA_CACHE.tasks[String(taskId)] = task;
    if (CURRENT_DATASET_ID)
        apiCall('POST', '/api/datasets/' + CURRENT_DATASET_ID + '/tasks', task).then(resp => {
            // API returns the server-assigned ID; ensure consistency
            if (resp && resp.id && resp.id !== taskId) {
                delete DATA_CACHE.tasks[String(taskId)];
                DATA_CACHE.tasks[String(resp.id)] = task;
            }
        });
    return taskId;
}

function dbHasTask(taskId) {
    return (DATA_CACHE.tasks || {})[String(taskId)] !== undefined;
}

function dbGetTask(taskId) {
    return (DATA_CACHE.tasks || {})[String(taskId)] || null;
}

function dbUpdateTask(taskId, task) {
    if (!DATA_CACHE.tasks) DATA_CACHE.tasks = {};
    DATA_CACHE.tasks[String(taskId)] = task;
    if (CURRENT_DATASET_ID)
        apiCall('PUT', '/api/datasets/' + CURRENT_DATASET_ID + '/tasks/' + taskId, task);
}

function dbDeleteTask(taskId) {
    delete (DATA_CACHE.tasks || {})[String(taskId)];
    if (CURRENT_DATASET_ID)
        apiCall('DELETE', '/api/datasets/' + CURRENT_DATASET_ID + '/tasks/' + taskId);
}


///////////////////////////////////////////////////////////////////////////////////////////////////
// Dataset selector, sharing, logout

function setupDatasetSelector(datasets) {
    const sel = document.querySelector('#dataset-select');
    if (!sel) return;
    sel.replaceChildren();
    for (const ds of datasets) {
        sel.appendChild(newElem('option', ds.name, { value: ds.id }));
    }
    sel.appendChild(newElem('option', '------------', { value: '%', disabled: true }));
    sel.appendChild(newElem('option', 'Create new dataset', { value: '+' }));
    if (CURRENT_DATASET_ID) {
        sel.appendChild(newElem('option', 'Delete this dataset', { value: '-' }));
    }
    sel.value = String(CURRENT_DATASET_ID);

    sel.addEventListener('change', () => {
        if (sel.value === '+') {
            const name = prompt('Name of the new dataset?');
            if (name) {
                apiCall('POST', '/api/datasets', { name }).then(resp => {
                    setDatasetIdInUrl(resp.dataset.id);
                });
            } else {
                sel.value = String(CURRENT_DATASET_ID);
            }
        } else if (sel.value === '-') {
            if (confirm('Are you sure you want to delete this dataset? This cannot be undone.')) {
                apiCall('DELETE', '/api/datasets/' + CURRENT_DATASET_ID).then(() => {
                    window.location.search = '';
                }).catch(() => {
                    alert('Cannot delete dataset.');
                    sel.value = String(CURRENT_DATASET_ID);
                });
            } else {
                sel.value = String(CURRENT_DATASET_ID);
            }
        } else {
            setDatasetIdInUrl(sel.value);
        }
    });
}


function setupShareDialog() {
    const shareBtn = document.querySelector('#share-btn');
    if (!shareBtn) return;
    shareBtn.addEventListener('click', async () => {
        const dialog = document.querySelector('#share-dialog');
        const list = dialog.querySelector('#share-users-list');
        const form = dialog.querySelector('form');
        const errorElem = dialog.querySelector('.share-error');

        // Refresh user list
        try {
            const resp = await apiCall('GET', '/api/datasets/' + CURRENT_DATASET_ID + '/users');
            list.replaceChildren();
            for (const u of resp.users) {
                const li = newElem('li', u.username + ' (' + u.permission + ')');
                if (u.id !== CURRENT_USER.id) {
                    li.appendChild(newElem('button', 'Remove', { class: 'remove-user-btn' }));
                    li.querySelector('button').addEventListener('click', async () => {
                        await apiCall('DELETE', '/api/datasets/' + CURRENT_DATASET_ID + '/users/' + u.id);
                        li.remove();
                    });
                }
                list.appendChild(li);
            }
        } catch { return; }

        errorElem.textContent = '';
        form.reset();
        dialog.showModal();

        dialog.addEventListener('close', async function handler() {
            dialog.removeEventListener('close', handler);
            if (dialog.returnValue === 'share-submit') {
                const username = form.elements['username'].value.trim();
                const permission = form.elements['permission'].value;
                if (!username) return;
                try {
                    await apiCall('POST', '/api/datasets/' + CURRENT_DATASET_ID + '/share', { username, permission });
                } catch (err) {
                    errorElem.textContent = err.message;
                }
            }
        }, { once: true });
    });
}


function setupLogoutButton() {
    const btn = document.querySelector('#logout-btn');
    if (!btn) return;
    btn.addEventListener('click', async () => {
        await apiCall('POST', '/api/auth/logout');
        CURRENT_USER = null;
        window.location.reload();
    });
}
