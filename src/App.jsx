import React, { useState, useRef, useEffect, useCallback, useMemo } from "react";
import * as htmlToImage from "html-to-image";
import { motion } from "framer-motion";
import { Upload, Image, Palette, Sliders, Download, Users, ChevronDown, Settings, X, BarChart3, ArrowUpDown, Trash2, RotateCcw, RotateCw, SquareX, Maximize, ChevronUp, Expand, Minimize, Layers, Save, ArrowUpFromLine, FileSpreadsheet, Search, FolderInput, FolderOutput, ChevronsDown, ChevronsUp, ThumbsDown } from "lucide-react";

// --- Утилиты для IndexedDB (Обход лимита 5МБ) ---
const DB_NAME = 'PickemEditorDB';
const STORE_NAME = 'projects';
const DB_KEY = 'pickem_editor_state'; 
const DB_VERSION = 1;

const initDB = () => new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = (event) => {
        const db = event.target.result;
        if (!db.objectStoreNames.contains(STORE_NAME)) {
            db.createObjectStore(STORE_NAME);
        }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
});

const saveToDB = async (key, data) => {
    const db = await initDB();
    return new Promise((resolve, reject) => {
        const tx = db.transaction(STORE_NAME, 'readwrite');
        const store = tx.objectStore(STORE_NAME);
        const request = store.put(data, key);
        request.onsuccess = () => resolve();
        request.onerror = () => reject(request.error);
    });
};

const loadFromDB = async (key) => {
    const db = await initDB();
    return new Promise((resolve, reject) => {
        const tx = db.transaction(STORE_NAME, 'readonly');
        const store = tx.objectStore(STORE_NAME);
        const request = store.get(key);
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
    });
};

// --- Утилиты и Хелперы ---
const clamp = (val, min, max) => Math.min(Math.max(val, min), max);
const getNumValue = (val) => { const num = parseInt(val, 10); return isNaN(num) ? 0 : num; };
const SCHEMA_VERSION = 2; 

// --- Компонент: Подсветка текста ---
const HighlightedText = ({ text, highlight, onClick }) => {
    if (!highlight.trim()) {
        return <div onClick={onClick} className="w-full h-full flex items-center cursor-text truncate">{text}</div>;
    }
    const parts = text.split(new RegExp(`(${highlight.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})`, 'gi'));
    return (
        <div onClick={onClick} className="w-full h-full flex items-center cursor-text whitespace-pre truncate">
            {parts.map((part, i) =>
                part.toLowerCase() === highlight.toLowerCase() ?
                    <span key={i} className="bg-yellow-500/50 text-white rounded-[1px]">{part}</span> :
                    <span key={i}>{part}</span>
            )}
        </div>
    );
};

// --- Утилиты для создания сущностей ---
const createRow = (i) => ({
  id: `r-${i}`,
  nick: `Player ${i + 1}`,
  avatar: "",
  avatarScale: 100,
  avatarPosX: 50,
  avatarPosY: 50,
  three0: Array(2).fill(null),
  pass: Array(6).fill(null),
  out: Array(2).fill(null),
  nickFontSize: 14,
});

const getInitialRows = (count) => Array.from({ length: count }, (_, i) => createRow(i));

const createStage = (name, index) => ({
    id: `s-${Date.now()}-${index}`,
    name: name || `Этап ${index + 1}`,
    rows: getInitialRows(10),
    rowCount: 10,
    stats: [],
    correctTeams: { three0: [], pass: [], out: [] },
});

// Оптимизированная загрузка картинок (Resize + Canvas)
const readFileAsDataURL = (file) =>
  new Promise((res) => {
    const reader = new FileReader();
    reader.onload = (event) => {
        const img = new window.Image();
        img.onload = () => {
            const canvas = document.createElement("canvas");
            const MAX_SIZE = 256; 
            let width = img.width;
            let height = img.height;
            
            if (width > height) {
                if (width > MAX_SIZE) {
                    height *= MAX_SIZE / width;
                    width = MAX_SIZE;
                }
            } else {
                if (height > MAX_SIZE) {
                    width *= MAX_SIZE / height;
                    height = MAX_SIZE;
                }
            }
            
            canvas.width = width;
            canvas.height = height;
            const ctx = canvas.getContext("2d");
            ctx.drawImage(img, 0, 0, width, height);
            
            const dataUrl = canvas.toDataURL("image/png");
            
            res({ 
                id: `${file.name}-${Date.now()}-${Math.random()}`, 
                src: dataUrl, 
                name: file.name.split(".").slice(0, -1).join("."),
                categoryId: null 
            });
        };
        img.src = event.target.result;
    };
    reader.readAsDataURL(file);
  });

const getAreaTitle = (area) => area === 'three0' ? '3-0' : area === 'pass' ? 'Проход' : area === 'out' ? '0-3' : area;
const getCurrentDateString = () => new Date().toISOString().slice(0, 10);

// --- Начальное состояние ---
const INITIAL_STAGE = createStage(null, 0);
const INITIAL_STATE_BASE = {
    schemaVersion: SCHEMA_VERSION,
    stages: [INITIAL_STAGE],
    activeStageId: INITIAL_STAGE.id,
    library: [],
    libraryCategories: [], 
    bg: "#101018",
    bgImg: "",
    bgScale: 115,
    bgPosX: 50,
    bgPosY: 50,
    verticalPad: 100,
    horizontalPad: 40,
    borderRadius: 0,
    avatarsEnabled: true,
    highlightPicksEnabled: false,
    popularitySortEnabled: false,
    nickColWidth: 120,
    tableOffsetY: 0,
    transparentBackgroundEnabled: false, 
};

// --- Миграция V1 -> V2 ---
const migrateV1StateToV2 = (v1State) => {
    console.log("Migrating V1 state to V2...");
    const validatedRows = (v1State.rows || getInitialRows(10)).map(r => ({...createRow(0), ...r, avatarScale: r.avatarScale || 100, avatarPosX: r.avatarPosX || 50, avatarPosY: r.avatarPosY || 50 }));
    
    const newStage = {
        id: INITIAL_STATE_BASE.activeStageId, 
        name: "Этап 1 (Imported)",
        rows: validatedRows,
        rowCount: validatedRows.length,
        stats: Array.isArray(v1State.stats) ? v1State.stats : [],
        correctTeams: v1State.correctTeams || INITIAL_STAGE.correctTeams,
    };

    return {
        ...INITIAL_STATE_BASE, 
        library: (v1State.library || []).map(icon => ({...icon, categoryId: null })),
        libraryCategories: [], 
        bg: v1State.bg || INITIAL_STATE_BASE.bg,
        bgImg: v1State.bgImg || "",
        bgScale: v1State.bgScale || INITIAL_STATE_BASE.bgScale,
        bgPosX: v1State.bgPosX || INITIAL_STATE_BASE.bgPosX,
        bgPosY: v1State.bgPosY || INITIAL_STATE_BASE.bgPosY,
        verticalPad: v1State.verticalPad || INITIAL_STATE_BASE.verticalPad,
        horizontalPad: v1State.horizontalPad || INITIAL_STATE_BASE.horizontalPad,
        borderRadius: v1State.borderRadius || INITIAL_STATE_BASE.borderRadius,
        avatarsEnabled: v1State.avatarsEnabled !== undefined ? v1State.avatarsEnabled : INITIAL_STATE_BASE.avatarsEnabled,
        highlightPicksEnabled: v1State.highlightPicksEnabled !== undefined ? v1State.highlightPicksEnabled : INITIAL_STATE_BASE.highlightPicksEnabled,
        popularitySortEnabled: v1State.popularitySortEnabled !== undefined ? v1State.popularitySortEnabled : INITIAL_STATE_BASE.popularitySortEnabled,
        nickColWidth: v1State.nickColWidth || INITIAL_STATE_BASE.nickColWidth,
        tableOffsetY: v1State.tableOffsetY || INITIAL_STATE_BASE.tableOffsetY,
        transparentBackgroundEnabled: v1State.transparentBackgroundEnabled !== undefined ? v1State.transparentBackgroundEnabled : INITIAL_STATE_BASE.transparentBackgroundEnabled,
        stages: [newStage],
        activeStageId: newStage.id,
    };
};

// --- Экспорт/Импорт ---
const exportFullState = (state) => {
    const dataStr = JSON.stringify(state, null, 2); 
    const blob = new Blob([dataStr], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `pickem_full_state_v${SCHEMA_VERSION}_${getCurrentDateString()}.pickemfull`;
    link.click();
    URL.revokeObjectURL(url);
};

// --- Функция импорта (importData) ---
const importData = (e, setAppState, dataType) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (event) => {
        try {
            const fileContent = JSON.parse(event.target.result);
            let successMessage = "";
            const validateRows = (rows) => (rows || []).map(r => ({
              ...createRow(0),
              ...r,
              avatarScale: r?.avatarScale || 100,
              avatarPosX: r?.avatarPosX || 50,
              avatarPosY: r?.avatarPosY || 50,
              three0: Array.isArray(r?.three0) ? r.three0.slice(0, 2) : Array(2).fill(null),
              pass: Array.isArray(r?.pass) ? r.pass.slice(0, 6) : Array(6).fill(null),
              out: Array.isArray(r?.out) ? r.out.slice(0, 2) : Array(2).fill(null),
              nickFontSize: r?.nickFontSize || 14,
            }));

            if (dataType === 'full') {
                let newState;
                if (!fileContent.schemaVersion) {
                    const dataToProcess = fileContent.rows ? fileContent : { rows: fileContent };
                    if (typeof dataToProcess === 'object' && (Array.isArray(dataToProcess.rows) || dataToProcess.library)) {
                        newState = migrateV1StateToV2(dataToProcess);
                        successMessage = `Успешно импортирован старый проект и конвертирован в V2!`;
                    } else {
                        throw new Error("Неверный формат V1 файла.");
                    }
                } else {
                    newState = { 
                        ...INITIAL_STATE_BASE, 
                        ...fileContent,
                        library: (fileContent.library || []).map(icon => ({...icon, categoryId: icon.categoryId || null })),
                        stages: (fileContent.stages || []).map(s => ({ ...s, stats: Array.isArray(s.stats) ? s.stats : [] }))
                    };
                    successMessage = `Успешно загружен проект!`;
                }
                setAppState(newState);

            } else if (dataType === 'pickem') {
                 if (Array.isArray(fileContent.rows)) {
                    const validatedRows = validateRows(fileContent.rows);
                    setAppState(prevState => ({
                        ...prevState,
                        stages: prevState.stages.map(stage => 
                            stage.id === prevState.activeStageId 
                            ? { ...stage, rows: validatedRows, rowCount: validatedRows.length }
                            : stage
                        )
                    }));
                    successMessage = `Загружено ${validatedRows.length} строк пикемов!`;
                } else {
                    throw new Error("Неверный формат файла.");
                }
            } else if (dataType === 'stats') {
                if (Array.isArray(fileContent.stats) || typeof fileContent.correctTeams === 'object') {
                    const newStats = Array.isArray(fileContent.stats) ? fileContent.stats : [];
                    const newCorrectTeams = typeof fileContent.correctTeams === 'object' ? fileContent.correctTeams : INITIAL_STAGE.correctTeams;
                    setAppState(prevState => ({
                        ...prevState,
                        stages: prevState.stages.map(stage => 
                            stage.id === prevState.activeStageId 
                            ? { ...stage, stats: newStats, correctTeams: newCorrectTeams }
                            : stage
                        )
                    }));
                    successMessage = `Загружена статистика!`;
                } else {
                    throw new Error("Неверный формат файла статистики.");
                }
            }
            if (dataType !== 'full') {
                alert(successMessage);
            }
        } catch (error) {
            console.error(`Ошибка при импорте (${dataType}):`, error);
            alert(`Ошибка: ${error.message}`);
        }
    };
    reader.readAsText(file);
    e.target.value = null; 
};


// --- Компонент UI (NumControl) ---
const NumControl = ({ label, value, setter, min = -300, max = 300, step = 1, largeStep = 10, unit = "px" }) => (
    <div className="space-y-1">
        <div className="flex justify-between text-xs font-medium text-gray-300">
            <span>{label}</span>
            <span className="text-orange-400">{value}{unit}</span>
        </div>
        <div className="flex gap-1">
            <button onClick={() => setter(p => clamp(getNumValue(p) - largeStep, min, max))} className="flex-shrink-0 w-8 h-6 bg-red-600/70 text-white rounded-l text-xs hover:bg-red-500 transition" title={`-${largeStep}`}>-{largeStep}</button>
            <button onClick={() => setter(p => clamp(getNumValue(p) - step, min, max))} className="flex-shrink-0 w-8 h-6 bg-red-600/40 text-white text-xs hover:bg-red-500/70 transition" title={`-${step}`}>-{step}</button>
            <input
                type="number" min={min} max={max} step={step} value={value}
                onChange={(e) => setter(e.target.value)} 
                className="flex-1 h-6 text-white text-xs rounded-none px-1 py-0 bg-neutral-700 text-left focus:ring-1 focus:ring-orange-400 focus:border-orange-400 border-none"
                style={{ WebkitAppearance: 'none', MozAppearance: 'textfield' }}
            />
            <button onClick={() => setter(p => clamp(getNumValue(p) + step, min, max))} className="flex-shrink-0 w-8 h-6 bg-green-600/40 text-white text-xs hover:bg-green-500/70 transition" title={`+${step}`}>+{step}</button>
            <button onClick={() => setter(p => clamp(getNumValue(p) + largeStep, min, max))} className="flex-shrink-0 w-8 h-6 bg-green-600/70 text-white rounded-r text-xs hover:bg-green-500 transition" title={`+${largeStep}`}>+{largeStep}</button>
        </div>
    </div>
);


// --- Компонент: StageItem ---
const StageItem = ({ stage, isActive, onSelect, onRename, onDelete, isOnlyStage }) => {
    const [name, setName] = useState(stage.name);
    const inputRef = useRef(null);

    useEffect(() => {
        if (stage.name !== name) {
            setName(stage.name);
        }
    }, [stage.name]);

    const handleRename = () => {
        if (name.trim() === "") {
            setName(stage.name); 
        } else if (name !== stage.name) {
            onRename(stage.id, name);
        }
    };

    const handleKeyDown = (e) => {
        if (e.key === 'Enter') {
            handleRename();
            inputRef.current?.blur(); 
        } else if (e.key === 'Escape') {
            setName(stage.name); 
            inputRef.current?.blur();
        }
    };

    return (
        <div 
            onClick={() => { if (!isActive) onSelect(stage.id); }}
            className={`flex items-center gap-2 p-2 rounded-lg border transition-all ${
                isActive 
                ? 'bg-orange-900/50 border-orange-600' 
                : 'bg-neutral-700/50 border-neutral-600 hover:bg-neutral-700 cursor-pointer'
            }`}
            role="button"
            tabIndex={isActive ? -1 : 0}
            onKeyDown={(e) => { if ((e.key === "Enter" || e.key === " ") && !isActive) onSelect(stage.id); }}
        >
            <input 
                ref={inputRef}
                type="text"
                value={name}
                onClick={(e) => e.stopPropagation()} 
                onChange={(e) => setName(e.target.value)} 
                onBlur={handleRename} 
                onKeyDown={handleKeyDown} 
                className={`flex-1 text-sm bg-transparent outline-none focus:ring-1 rounded px-1 py-0.5 ${
                    isActive ? 'text-orange-300 focus:ring-orange-400' : 'text-white focus:ring-gray-400'
                }`}
                title="Переименовать этап"
            />
            <button 
                onClick={(e) => {
                    e.stopPropagation(); 
                    onDelete(stage.id);
                }} 
                disabled={isOnlyStage} 
                className="text-red-500/70 hover:text-red-400 disabled:opacity-30 disabled:cursor-not-allowed flex-shrink-0"
                title="Удалить этап"
            >
                <Trash2 size={14} />
            </button>
        </div>
    );
};


// --- Компонент: LibraryIconItem ---
const LibraryIconItem = ({ icon, onRename, onRemove, onDragStart, onContextMenu }) => {
    const [name, setName] = useState(icon.name);
    const inputRef = useRef(null);

    useEffect(() => {
        if (icon.name !== name) {
            setName(icon.name);
        }
    }, [icon.name]);

    const handleRename = () => {
        if (name.trim() === "") {
            setName(icon.name);
        } else if (name !== icon.name) {
            onRename(icon.id, name);
        }
    };

    const handleKeyDown = (e) => {
        if (e.key === 'Enter') {
            handleRename();
            inputRef.current?.blur();
        } else if (e.key === 'Escape') {
            setName(icon.name);
            inputRef.current?.blur();
        }
    };

    return (
        <div 
            className="relative group bg-neutral-700 rounded-lg overflow-hidden border border-neutral-600 hover:border-orange-400/50 transition-all flex flex-col"
            onContextMenu={(e) => onContextMenu(e, icon)}
        >
            <div className="h-12 flex items-center justify-center p-1">
                <img 
                    src={icon.src} 
                    draggable 
                    onDragStart={(e) => onDragStart(e, icon)} 
                    className="max-w-full max-h-12 object-contain cursor-grab" 
                    alt={icon.name} 
                    style={{ WebkitUserDrag: "element" }} 
                />
            </div>
            <button 
                onClick={() => onRemove(icon.id)} 
                className="absolute top-0 right-0 bg-red-600/80 rounded-bl text-white opacity-0 group-hover:opacity-100 transition p-0.5 z-10" 
                aria-label={`remove-${icon.id}`}
            >
                <X size={10} />
            </button>
            <input
                ref={inputRef}
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                onBlur={handleRename}
                onKeyDown={handleKeyDown}
                className="w-full text-xs bg-neutral-800 text-white text-center p-0.5 outline-none focus:ring-1 focus:ring-orange-400"
                title="Переименовать"
            />
        </div>
    );
};


// --- Основной Компонент Приложения ---
export default function App() {
  
  // --- ЛОГИКА ЕДИНОЙ ИСТОРИИ (UNDO/REDO) С ИНИЦИАЛИЗАЦИЕЙ ---
  const MAX_HISTORY = 50; 
  
  const [appStateHistory, setAppStateHistory] = useState({
    current: INITIAL_STATE_BASE,
    history: [INITIAL_STATE_BASE],
    index: 0
  });
  
  const [isLoaded, setIsLoaded] = useState(false);

  useEffect(() => {
    const loadState = async () => {
        try {
            const storedState = await loadFromDB(DB_KEY);
            if (storedState) {
                let stateToUse = storedState;
                if (!stateToUse.schemaVersion || stateToUse.schemaVersion < SCHEMA_VERSION) {
                    console.log("Migrating state from IndexedDB...");
                    stateToUse = migrateV1StateToV2(stateToUse);
                }
                setAppStateHistory({ 
                    current: stateToUse, 
                    history: [stateToUse], 
                    index: 0 
                });
                console.log("Успешно загружено из IndexedDB!");
            }
        } catch (err) {
            console.error("Ошибка загрузки DB:", err);
        } finally {
            setIsLoaded(true);
        }
    };
    loadState();
  }, []);

  const appState = appStateHistory.current; 
  const canUndo = appStateHistory.index > 0;
  const canRedo = appStateHistory.index < appStateHistory.history.length - 1;

  // --- Стейт для File System Access ---
  const [fileHandle, setFileHandle] = useState(null);
  // --- Стейт для поиска в пикере ---
  const [pickerSearch, setPickerSearch] = useState("");
  // --- Стейт для сворачивания частот ---
  const [frequenciesExpanded, setFrequenciesExpanded] = useState(false);
  // --- Стейт для поиска в статистике ---
  const [statsSearch, setStatsSearch] = useState(""); 
  // --- Стейт для редактирования в статистике ---
  const [editingStatId, setEditingStatId] = useState(null);

  const setAppState = useCallback((newStateOrFn) => {
      setAppStateHistory((prevState) => {
          const newState = typeof newStateOrFn === 'function' ? newStateOrFn(prevState.current) : newStateOrFn;
          if (JSON.stringify(newState) === JSON.stringify(prevState.current)) return prevState;
          const stateToStore = JSON.parse(JSON.stringify(newState));
          const newHistory = prevState.history.slice(0, prevState.index + 1);
          newHistory.push(stateToStore);
          let newIndex = newHistory.length - 1;
          if (newHistory.length > MAX_HISTORY) {
              newHistory.shift();
              newIndex--;
          }
          return { current: stateToStore, history: newHistory, index: newIndex };
      });
  }, []);

  const undo = useCallback(() => {
      setAppStateHistory(prevState => {
          if (prevState.index <= 0) return prevState;
          const newIndex = prevState.index - 1;
          return { ...prevState, current: prevState.history[newIndex], index: newIndex };
      });
  }, []);

  const redo = useCallback(() => {
      setAppStateHistory(prevState => {
          if (prevState.index >= prevState.history.length - 1) return prevState;
          const newIndex = prevState.index + 1;
          return { ...prevState, current: prevState.history[newIndex], index: newIndex };
      });
  }, []);

  // --- ЛОГИКА СОХРАНЕНИЯ В ФАЙЛ ---
  const writeToFile = async (handle, data) => {
    const writable = await handle.createWritable();
    await writable.write(JSON.stringify(data, null, 2));
    await writable.close();
  };

  const saveProjectAs = async () => {
    if (!window.showSaveFilePicker) {
        alert("Ваш браузер не поддерживает сохранение в файл (File System Access API).");
        return;
    }
    try {
        const handle = await window.showSaveFilePicker({
            suggestedName: `pickem_project_${getCurrentDateString()}.pickemfull`,
            types: [{
                description: 'Pickem Project File',
                accept: { 'application/json': ['.pickemfull'] },
            }],
        });
        setFileHandle(handle);
        await writeToFile(handle, appState);
        alert("Проект сохранен и связан с файлом. Теперь работает автосохранение (Ctrl+S).");
    } catch (err) {
        if (err.name !== 'AbortError') {
             console.error("Save cancelled or failed", err);
             alert("Ошибка сохранения файла: " + err.message);
        }
    }
  };

  const quickSave = async () => {
    if (fileHandle) {
        try {
            await writeToFile(fileHandle, appState);
            console.log("Auto-saved to file!"); 
        } catch (err) {
            console.error("Auto-save failed", err);
            setFileHandle(null); 
            alert("Потерян доступ к файлу. Сохраните заново.");
        }
    } else {
        saveProjectAs();
    }
  };

  useEffect(() => {
      const handleKeyDown = (event) => {
          if (event.ctrlKey || event.metaKey) {
              if (event.key === 'z') { event.preventDefault(); undo(); }
              else if (event.key === 'y' || (event.shiftKey && event.key === 'Z')) { event.preventDefault(); redo(); }
              else if (event.key === 's') { 
                  event.preventDefault(); 
                  quickSave(); 
              }
          }
      };
      window.addEventListener('keydown', handleKeyDown);
      return () => window.removeEventListener('keydown', handleKeyDown);
  }, [undo, redo, fileHandle, appState]); 


  // --- Деструктуризация стейта V2 ---
  const { 
    stages, activeStageId, library, libraryCategories, 
    bg, bgImg, bgScale, bgPosX, bgPosY, verticalPad, horizontalPad, 
    borderRadius, avatarsEnabled, highlightPicksEnabled, popularitySortEnabled, nickColWidth, tableOffsetY, transparentBackgroundEnabled 
  } = appState;

  const activeStage = useMemo(() => {
    return stages.find(s => s.id === activeStageId) || stages[0];
  }, [stages, activeStageId]);

  const { rows, rowCount, stats, correctTeams } = activeStage;

  // --- Синхронизация категорий и этапов ---
  useEffect(() => {
    setAppState(p => {
        const newCategories = p.stages.map(s => ({ id: s.id, name: s.name }));
        const oldCategories = p.libraryCategories || [];
        if (newCategories.length === oldCategories.length && 
            newCategories.every((cat, i) => cat.id === oldCategories[i].id && cat.name === oldCategories[i].name)) {
            return p; 
        }
        return { ...p, libraryCategories: newCategories };
    });
  }, [appState.stages, setAppState]); 


  // --- Сеттеры ---
  const updateSingleValue = useCallback((key, valueOrFn) => {
    setAppState(p => {
        const newValue = typeof valueOrFn === 'function' ? valueOrFn(p[key]) : valueOrFn;
        return { ...p, [key]: newValue };
    });
  }, [setAppState]);
  
  const updateActiveStage = useCallback((updaterFn) => {
      setAppState(prevState => {
          const currentActiveId = prevState.activeStageId;
          const newStages = prevState.stages.map(stage => {
              if (stage.id === currentActiveId) {
                  return updaterFn(stage); 
              }
              return stage;
          });
          return { ...prevState, stages: newStages };
      });
  }, [setAppState]);
  
  const setNumberValue = useCallback((key) => (val) => {
      const processedVal = typeof val === 'function' ? val : getNumValue(val);
      updateSingleValue(key, processedVal);
  }, [updateSingleValue]);
  
  const setBg = (val) => updateSingleValue('bg', val);
  const setBgScale = setNumberValue('bgScale');
  const setBgPosX = setNumberValue('bgPosX');
  const setBgPosY = setNumberValue('bgPosY');
  const setVerticalPad = setNumberValue('verticalPad');
  const setHorizontalPad = setNumberValue('horizontalPad');
  const setBorderRadius = setNumberValue('borderRadius');
  const setTableOffsetY = setNumberValue('tableOffsetY');
  const setAvatarsEnabled = (val) => updateSingleValue('avatarsEnabled', val);
  const setHighlightPicksEnabled = (val) => updateSingleValue('highlightPicksEnabled', val);
  const setPopularitySortEnabled = (val) => updateSingleValue('popularitySortEnabled', val);
  const setNickColWidth = setNumberValue('nickColWidth');
  
  const setLibrary = useCallback((newLibraryFn) => {
      setAppState(p => ({ ...p, library: newLibraryFn(p.library) }));
  }, [setAppState]);


  // --- Хендлеры Этапов ---
  const updateRowCount = useCallback((newCount) => {
    updateActiveStage(stage => {
        const currentCount = stage.rows.length;
        let newRows = stage.rows;
        if (newCount > currentCount) {
            const addedRows = Array.from({ length: newCount - currentCount }, (_, i) => createRow(currentCount + i));
            newRows = [...stage.rows, ...addedRows];
        } else if (newCount < currentCount) {
            newRows = stage.rows.slice(0, newCount);
        }
        return { ...stage, rows: newRows, rowCount: newRows.length };
    });
  }, [updateActiveStage]); 

  const setRowCount = (val) => {
    const newCount = Math.min(Math.max(Number(val) || 1, 1), 30);
    updateActiveStage(stage => ({ ...stage, rowCount: newCount }));
    updateRowCount(newCount); 
  }
  
  const setRows = useCallback((newRowsOrFn) => {
      updateActiveStage(stage => ({
          ...stage,
          rows: typeof newRowsOrFn === 'function' ? newRowsOrFn(stage.rows) : newRowsOrFn,
      }));
  }, [updateActiveStage]);

  const setCorrectTeams = useCallback((newTeamsOrFn) => {
      updateActiveStage(stage => ({
          ...stage,
          correctTeams: typeof newTeamsOrFn === 'function' ? newTeamsOrFn(stage.correctTeams) : newTeamsOrFn,
      }));
  }, [updateActiveStage]);

  const moveRow = useCallback((index, direction) => {
      setRows(prevRows => {
          const newRows = [...prevRows];
          const newIndex = index + direction;
          if (newIndex < 0 || newIndex >= newRows.length) return newRows;
          [newRows[index], newRows[newIndex]] = [newRows[newIndex], newRows[index]];
          return newRows;
      });
  }, [setRows]);

  const clearRowPicks = useCallback((rIdx) => {
      setRows(prevRows => {
          return prevRows.map((r, i) => {
              if (i !== rIdx) return r;
              return { 
                  ...r,
                  nick: `Player ${i + 1}`, 
                  three0: Array(2).fill(null),
                  pass: Array(6).fill(null),
                  out: Array(2).fill(null),
              };
          });
      });
  }, [setRows]);
  
  const setActiveStage = (id) => {
      updateSingleValue('activeStageId', id);
  };

  const addNewStage = () => {
      setAppState(prevState => {
          const newStage = createStage(null, prevState.stages.length);
          return {
              ...prevState,
              stages: [...prevState.stages, newStage],
              activeStageId: newStage.id, 
          };
      });
  };

  const deleteStage = (idToDelete) => {
      if (stages.length <= 1) {
          alert("Нельзя удалить последний этап.");
          return;
      }
      const stageName = stages.find(s => s.id === idToDelete)?.name || "этот этап";
      if (!window.confirm(`Вы уверены, что хотите удалить "${stageName}"? Это действие необратимо.`)) {
          return;
      }
      setAppState(prevState => {
          const newStages = prevState.stages.filter(s => s.id !== idToDelete);
          const newActiveId = prevState.activeStageId === idToDelete ? newStages[0].id : prevState.activeStageId;
          return { 
              ...prevState, 
              stages: newStages, 
              activeStageId: newActiveId,
              library: prevState.library.map(icon => 
                  icon.categoryId === idToDelete ? { ...icon, categoryId: null } : icon
              )
          };
      });
  };

  const renameStage = useCallback((id, newName) => {
      setAppState(prevState => ({
          ...prevState,
          stages: prevState.stages.map(s => 
              s.id === id ? { ...s, name: newName } : s
          )
      }));
  }, [setAppState]);
  
  
  // --- Хендлеры Библиотеки ---
  const onIconUpload = async (e) => {
    const files = Array.from(e.target.files || []);
    const imgs = await Promise.all(files.map(readFileAsDataURL));
    setLibrary((p) => [...p, ...imgs]);
    if (e.target) e.target.value = null;
  };
  
  const removeIcon = useCallback((id) => setLibrary((p) => p.filter((i) => i.id !== id)), [setLibrary]);

  const renameIcon = useCallback((id, newName) => {
    setLibrary(p => p.map(icon => 
        icon.id === id ? { ...icon, name: newName } : icon
    ));
  }, [setLibrary]);

  const moveIconToCategory = useCallback((iconId, newCategoryId) => {
      setLibrary(p => p.map(icon => 
          icon.id === iconId ? { ...icon, categoryId: newCategoryId } : icon
      ));
  }, [setLibrary]);


  // --- ДРУГИЕ ХЕНДЛЕРЫ ---
  const onAvatarUpload = useCallback((e, idx) => {
      const file = e.target.files?.[0];
      if (!file) return;
      readFileAsDataURL(file).then(({ src }) =>
        setRows((rs) => rs.map((r, i) => (i === idx ? { ...r, avatar: src, avatarScale: 100, avatarPosX: 50, avatarPosY: 50 } : r)))
      );
      if (e.target) e.target.value = null;
    }, [setRows]);

  const openAvatarEditor = useCallback((rIdx) => {
    const row = rows[rIdx]; 
    if (!row || !row.avatar || !avatarsEnabled) return;
    setAvatarEditor({
      open: true,
      rowIdx: rIdx,
      scale: row.avatarScale || 100,
      posX: row.avatarPosX || 50,
      posY: row.avatarPosY || 50,
      src: row.avatar,
    });
  }, [rows, avatarsEnabled]);

  const [openSection, setOpenSection] = useState("stages");
  const [avatarEditor, setAvatarEditor] = useState({ open: false, rowIdx: null, scale: 100, posX: 50, posY: 50, src: "" });
  const [picker, setPicker] = useState({ open: false, target: null, position: { top: 0, left: 0 } });
  
  const [iconContextMenu, setIconContextMenu] = useState({ open: false, iconId: null, x: 0, y: 0 });
  
  const [sortConfig, setSortConfig] = useState({ key: "score", direction: "descending" });
  const [isFullScreen, setIsFullScreen] = useState(false);
  const [statsTransparent, setStatsTransparent] = useState(false); 

  const exportRef = useRef(null);
  const statsRef = useRef(null); 
  const dragRef = useRef(null);
  const libraryRef = useRef(null);
  const pickerRef = useRef(null);

  const closeAvatarEditor = useCallback(() => setAvatarEditor(p => ({ ...p, open: false, rowIdx: null })), []);

  const saveAvatarSettings = useCallback(() => {
    if (avatarEditor.rowIdx === null) return;
    setRows(prevRows => prevRows.map((r, i) => 
        i === avatarEditor.rowIdx ? {
            ...r,
            avatarScale: avatarEditor.scale,
            avatarPosX: avatarEditor.posX,
            avatarPosY: avatarEditor.posY,
        } : r
    ));
    closeAvatarEditor();
  }, [avatarEditor, closeAvatarEditor, setRows]);
  
  const setAvatarEditorValue = (key) => (val) => {
      setAvatarEditor(p => ({
          ...p,
          [key]: typeof val === 'function' ? val(p[key]) : getNumValue(val)
      }));
  };

  const openPicker = useCallback((rIdx, area, cIdx, currentIconSrc, targetElement) => {
    if (targetElement) {
      const rect = targetElement.getBoundingClientRect();
      const top = rect.top + window.scrollY + rect.height + 8;
      const left = rect.left + window.scrollX + rect.width / 2;
      setPicker(p => ({ open: true, target: { rIdx, area, cIdx, currentIconSrc }, position: { top, left } }));
      setPickerSearch("");
    }
    setTimeout(() => libraryRef.current?.scrollTo?.({ top: 0 }), 0);
  }, []);

  const closePicker = useCallback(() => setPicker(p => ({ ...p, open: false, target: null, position: { top: 0, left: 0 } })), []);

  const selectIconForCell = useCallback((iconSrc) => {
      if (!picker.target) return;
      const { rIdx, area, cIdx } = picker.target;
      const newIconSrc = iconSrc === "REMOVE_ICON" ? null : iconSrc;
      setRows((rows) =>
        rows.map((r, i) =>
i === rIdx ? { ...r, [area]: r[area].map((cell, j) => (j === cIdx ? newIconSrc : cell)) } : r
        )
      );
      closePicker();
    }, [picker, closePicker, setRows]);

  // (Хендлеры контекстного меню)
  const closeIconContextMenu = useCallback(() => {
      setIconContextMenu({ open: false, iconId: null, x: 0, y: 0 });
  }, []);

  const openIconContextMenu = useCallback((e, icon) => {
      e.preventDefault();
      e.stopPropagation();
      setIconContextMenu({ open: true, iconId: icon.id, x: e.clientX, y: e.clientY });
  }, []);

  useEffect(() => {
      if (!iconContextMenu.open) return;
      const handleClickOutside = (e) => {
          closeIconContextMenu();
      };
      window.addEventListener('mousedown', handleClickOutside);
      window.addEventListener('contextmenu', handleClickOutside, { capture: true }); 
      return () => {
          window.removeEventListener('mousedown', handleClickOutside);
          window.removeEventListener('contextmenu', handleClickOutside, { capture: true });
      };
  }, [iconContextMenu.open, closeIconContextMenu]);

  
  // --- Хендлеры Drag-n-Drop ---
  const onDragStartIcon = useCallback((e, item) => {
    try {
      e.dataTransfer.setData("text/pickem-icon-src", item.src || "");
      e.dataTransfer.setData("text/pickem-icon-id", item.id || "");
      
      e.dataTransfer.effectAllowed = "move";
      dragRef.current = item; 
      if (e.target?.style) e.target.style.opacity = "0.8";
    } catch (err) {}
  }, []);

  const onDragEnd = useCallback((e) => {
    try { if (e.target?.style) e.target.style.opacity = ""; } catch {}
    dragRef.current = null;
  }, []);

  const onDragOverCell = useCallback((e) => e.preventDefault(), []);

  const onDropOnCategory = useCallback((e, categoryId) => {
      e.preventDefault();
      e.stopPropagation();
      try {
          const iconId = e.dataTransfer.getData("text/pickem-icon-id");
          if (iconId) {
              moveIconToCategory(iconId, categoryId);
          }
      } catch (err) { console.error("Category drop error", err); }
  }, [moveIconToCategory]);

  const onDragOverCategory = useCallback((e) => { 
      e.preventDefault(); 
      e.stopPropagation(); 
  }, []);

  const onDrop = useCallback((e, rIdx, area, cIdx) => {
    e.preventDefault();
    try {
      let payload = e.dataTransfer.getData("text/pickem-icon-src");
      if (!payload) {
          payload = dragRef.current?.src || e.dataTransfer.getData("text/plain") || null;
      }
      if (!payload) return;

      setRows((rs) => rs.map((r, i) => {
          if (i !== rIdx) return r;
          const isAlready = r[area].includes(payload);
          if (isAlready && r[area][cIdx] !== payload) {
            alert(`Команда уже выбрана в категории "${getAreaTitle(area)}".`);
            return r;
          }
          return { ...r, [area]: r[area].map((cell, j) => (j === cIdx ? payload : cell)) };
        }));
    } catch (err) { console.error("drop error", err); } finally { dragRef.current = null; }
  }, [setRows]);
  
  
  // --- Хендлеры Статистики ---
  const calculateScore = useCallback((playerRow, currentCorrectTeams) => ["three0", "pass", "out"].reduce((score, area) => score + (Array.isArray(playerRow[area]) ? playerRow[area].filter((team) => currentCorrectTeams[area].includes(team)).length : 0), 0), []);

  const isDuplicate = useCallback((newRow, existingStat) => {
    const nickMatch = (newRow.nick || "").trim().toLowerCase() === (existingStat.nick || "").trim().toLowerCase();
    if (!nickMatch) return false;
    const three0Match = JSON.stringify(newRow.three0) === JSON.stringify(existingStat.three0);
    const passMatch = JSON.stringify(newRow.pass) === JSON.stringify(existingStat.pass);
    const outMatch = JSON.stringify(newRow.out) === JSON.stringify(existingStat.out);
    return three0Match && passMatch && outMatch;
  }, []);

  const addToStats = () => {
    updateActiveStage(stage => {
        const { rows, stats, correctTeams } = stage;
        
        const rowsToAdd = [];
        const duplicatesFound = [];
        let emptyRowsSkipped = 0;

        rows.forEach((row, i) => {
            const isDefaultNick = row.nick.startsWith("Player ") && !row.avatar;
            const isPicksEmpty = row.three0.every(x => !x) && row.pass.every(x => !x) && row.out.every(x => !x);
            
            if (isDefaultNick && isPicksEmpty) {
                emptyRowsSkipped++;
                return; 
            }

            const isAlreadyInStats = stats.some(statRow => isDuplicate(row, statRow));

            if (isAlreadyInStats) {
                duplicatesFound.push(row.nick);
            } else {
                rowsToAdd.push({ 
                    ...JSON.parse(JSON.stringify(row)), 
                    id: `${row.id}-${Date.now()}-${i}`,
                    score: calculateScore(row, correctTeams) 
                });
            }
        });

        let alertMessage = "";

        if (rowsToAdd.length > 0) {
            alertMessage += `Успешно добавлено: ${rowsToAdd.length} записей.\n\n`;
        }

        if (duplicatesFound.length > 0) {
            alertMessage += `Обнаружены дубликаты (не добавлены):\n- ${duplicatesFound.join("\n- ")}\n\n`;
        }

        if (rowsToAdd.length === 0 && duplicatesFound.length > 0) {
            alertMessage = `Все игроки из таблицы уже есть в статистике. Новых данных не добавлено.\n\n(Найденные дубликаты: ${duplicatesFound.join(", ")})`;
        } else if (rowsToAdd.length === 0 && duplicatesFound.length === 0) {
            alertMessage = "Таблица пуста (или содержит только строки по умолчанию). Нечего добавлять в статистику.";
        }

        alert(alertMessage.trim());
        
        if (rowsToAdd.length === 0) {
            return stage; 
        }

        const newStats = [...stats, ...rowsToAdd];
        return { ...stage, stats: newStats };
    });
  };

  const clearStats = () => {
    if (!window.confirm("Вы уверены, что хотите очистить статистику для *текущего* этапа?")) return;
    updateActiveStage(stage => ({ ...stage, stats: [] }));
  };
  
  const deleteStatItem = (statId) => {
    if(!window.confirm("Удалить эту запись из статистики?")) return;
    updateActiveStage(stage => ({
        ...stage,
        stats: stage.stats.filter(s => s.id !== statId)
    }));
  };

  const updateStatNick = (statId, newNick) => {
      updateActiveStage(stage => ({
          ...stage,
          stats: stage.stats.map(s => s.id === statId ? { ...s, nick: newNick } : s)
      }));
  };

  const restoreRowFromStats = (statRow) => {
      updateActiveStage(stage => {
          const newRows = [...stage.rows];
          
          let emptyIndex = newRows.findIndex(r => 
              r.nick.startsWith("Player ") && 
              !r.avatar && 
              r.three0.every(x => !x) && 
              r.pass.every(x => !x) && 
              r.out.every(x => !x)
          );

          const restoredData = {
              ...statRow,
              id: emptyIndex !== -1 ? newRows[emptyIndex].id : createRow(newRows.length).id, 
              score: undefined 
          };

          if (emptyIndex !== -1) {
              newRows[emptyIndex] = restoredData;
              return { ...stage, rows: newRows };
          } else {
              const newRowWithId = { ...restoredData, id: createRow(newRows.length).id };
              return { 
                  ...stage, 
                  rows: [...newRows, newRowWithId], 
                  rowCount: stage.rowCount + 1 
              };
          }
      });
  };


  const toggleCorrect = useCallback((area, src) => {
    setCorrectTeams((prev) => {
      const list = new Set(prev[area] || []);
      list.has(src) ? list.delete(src) : list.add(src);
      return { ...prev, [area]: Array.from(list) };
    });
  }, [setCorrectTeams]);

  // --- Хендлеры UI ---
  const toggleFullScreen = useCallback(() => {
      if (!document.fullscreenElement) {
          document.documentElement.requestFullscreen().catch((err) => {
              alert(`Не удалось включить полноэкранный режим: ${err.message}`);
          });
      } else {
          if (document.exitFullscreen) {
              document.exitFullscreen();
          }
      }
  }, []);

  const handleNickScroll = (e, rIdx) => {
      e.preventDefault(); 
      const delta = e.deltaY > 0 ? -1 : 1; 
      
      setRows(prevRows => prevRows.map((r, i) => {
          if (i !== rIdx) return r;
          const currentSize = r.nickFontSize || 14;
          const newSize = clamp(currentSize + delta, 8, 32); 
          return { ...r, nickFontSize: newSize };
      }));
  };

  useEffect(() => {
      const handleFullScreenChange = () => {
          setIsFullScreen(!!document.fullscreenElement);
      };
      document.addEventListener('fullscreenchange', handleFullScreenChange);
      return () => document.removeEventListener('fullscreenchange', handleFullScreenChange);
  }, []);

  // --- Автосохранение в IndexedDB ---
  useEffect(() => {
    if (!isLoaded) return; // Не сохраняем, пока не загрузились
    
    const timer = setTimeout(async () => {
      try {
        await saveToDB(DB_KEY, appState);
      } catch (err) { console.error("Ошибка автосохранения в DB:", err); }
    }, 1000);
    return () => clearTimeout(timer);
  }, [appState, isLoaded]);
  
  // --- useMemo ---
  const teamNameMap = useMemo(() => {
    const map = {};
    library.forEach((item) => { if (item.src && item.name) map[item.src] = item.name; });
    return map;
  }, [library]);
  
  const sortedStats = useMemo(() => {
    if (!stats.length) return [];
    
    // 1. Считаем очки
    let sortableItems = stats.map((r) => ({ ...r, score: calculateScore(r, correctTeams) }));

    // 2. Фильтрация (Поиск)
    if (statsSearch.trim()) {
        const term = statsSearch.toLowerCase();
        sortableItems = sortableItems.filter(r => r.nick.toLowerCase().includes(term));
    }

    // 3. Сортировка
    if (sortConfig.key !== null) {
      sortableItems.sort((a, b) => {
        const key = sortConfig.key;
        let aValue = a[key] || 0;
        let bValue = b[key] || 0;
        if (key === "nick") {
          if (aValue < bValue) return sortConfig.direction === "ascending" ? -1 : 1;
          if (aValue > bValue) return sortConfig.direction === "ascending" ? 1 : -1;
          return 0;
        }
        if (aValue < bValue) return sortConfig.direction === "ascending" ? -1 : 1;
        if (aValue > bValue) return sortConfig.direction === "ascending" ? 1 : -1;
        return 0;
      });
    }
    return sortableItems;
  }, [stats, sortConfig, correctTeams, calculateScore, statsSearch]);
  
  const statCounts = useMemo(() => {
    const counts = {};
    stats.forEach((r) => ["three0", "pass", "out"].forEach((a) => {
        counts[a] = counts[a] || {};
        if (Array.isArray(r[a])) r[a].forEach((t) => { if (t) counts[a][t] = (counts[a][t] || 0) + 1; });
      })
    );
    return counts;
  }, [stats]);

  // --- useMemo для категорий (Picker) ---
  const categorizedIconsForPicker = useMemo(() => {
      const categories = [
          { id: null, name: "Без категории" },
          ...(libraryCategories || [])
      ];
      const iconMap = new Map();
      library.forEach(icon => {
          const catId = icon.categoryId || null;
          if (!iconMap.has(catId)) {
              iconMap.set(catId, []);
          }
          iconMap.get(catId).push(icon);
      });
      return categories.map(cat => ({
          ...cat,
          icons: iconMap.get(cat.id) || []
      })).filter(cat => cat.icons.length > 0);
  }, [library, libraryCategories]);

  // --- Фильтр для Picker: Оставляет структуру категорий, но фильтрует иконки внутри ---
  const filteredCategorizedIcons = useMemo(() => {
      const term = pickerSearch.toLowerCase().trim();
      if (!term) return categorizedIconsForPicker;

      return categorizedIconsForPicker.map(cat => ({
          ...cat,
          icons: cat.icons.filter(icon => (icon.name || "").toLowerCase().includes(term))
      })).filter(cat => cat.icons.length > 0);
  }, [categorizedIconsForPicker, pickerSearch]);

  // --- useMemo для категорий (Библиотека) ---
  const categorizedIcons = useMemo(() => {
      const categories = [
          { id: null, name: "Без категории" },
          ...(libraryCategories || [])
      ];
      const iconMap = new Map();
      library.forEach(icon => {
          const catId = icon.categoryId || null;
          if (!iconMap.has(catId)) {
              iconMap.set(catId, []);
          }
          iconMap.get(catId).push(icon);
      });
      return categories.map(cat => ({
          ...cat,
          icons: iconMap.get(cat.id) || []
      }))
  }, [library, libraryCategories]);

  // --- EXPORT PNG FIX ---
  const exportPNG = async (targetRef, fileNameBase, useFilter = false, isTransparent = false) => {
    if (!targetRef.current) return;
    const node = targetRef.current;

    const excludedElements = useFilter 
        ? Array.from(node.querySelectorAll('.export-exclude')) 
        : [];
    
    const originalDisplays = excludedElements.map(el => el.style.display);

    excludedElements.forEach(el => el.style.display = 'none');

    try {
      const width = node.offsetWidth;
      const height = node.offsetHeight;

      await Promise.all(Array.from(node.querySelectorAll("img")).map((img) => img.complete ? Promise.resolve() : new Promise((r) => (img.onload = img.onerror = r))));
      
      const options = {
          cacheBust: true, 
          backgroundColor: isTransparent ? null : '#171717', 
          pixelRatio: 2, 
          quality: 1, 
          crossOrigin: "anonymous",
          width: width,
          height: height,
      };

      if (useFilter) {
          options.filter = (node) => {
              return !node.classList?.contains('export-exclude');
          }
      }

      const dataUrl = await htmlToImage.toPng(node, options);
      const link = document.createElement("a");
      link.href = dataUrl;
      link.download = `${fileNameBase}_${activeStage.name.replace(/\s/g, '_') || 'stage'}.png`;
      link.click();
    } catch (err) { 
        console.error("PNG export failed:", err); 
        alert("Ошибка при экспорте PNG. Подробности в консоли."); 
    } finally {
        excludedElements.forEach((el, i) => {
            el.style.display = originalDisplays[i];
        });
    }
  };
  
  const exportColoredExcel = useCallback(() => {
    if (!sortedStats.length) return alert("Статистика для текущего этапа пуста.");
    
    const title = `Статистика: ${activeStage.name}`;
    
    let html = `
        <html>
        <head><meta charset="UTF-8"></head>
        <body>
            <h2>${title}</h2>
            <table border="1" style="border-collapse: collapse; text-align: center;">
                <thead>
                    <tr style="background-color: #f3f4f6;">
                        <th style="padding: 8px; background-color: #e5e7eb;">Игрок</th>
                        <th style="padding: 8px; background-color: #e5e7eb;">Счет</th>
                        <th style="padding: 8px; background-color: #bbf7d0;">3-0 (1)</th>
                        <th style="padding: 8px; background-color: #bbf7d0;">3-0 (2)</th>
                        <th style="padding: 8px; background-color: #fef08a;">Проход (1)</th>
                        <th style="padding: 8px; background-color: #fef08a;">Проход (2)</th>
                        <th style="padding: 8px; background-color: #fef08a;">Проход (3)</th>
                        <th style="padding: 8px; background-color: #fef08a;">Проход (4)</th>
                        <th style="padding: 8px; background-color: #fef08a;">Проход (5)</th>
                        <th style="padding: 8px; background-color: #fef08a;">Проход (6)</th>
                        <th style="padding: 8px; background-color: #fecaca;">0-3 (1)</th>
                        <th style="padding: 8px; background-color: #fecaca;">0-3 (2)</th>
                    </tr>
                </thead>
                <tbody>
    `;

    sortedStats.forEach(row => {
        html += `<tr><td style="padding: 5px; text-align: left; font-weight: bold;">${row.nick}</td>`;
        html += `<td style="padding: 5px; font-weight: bold; font-size: 16px;">${row.score}</td>`;

        const allPicks = [...row.three0, ...row.pass, ...row.out];
        const allAreas = [...Array(2).fill('three0'), ...Array(6).fill('pass'), ...Array(2).fill('out')];

        allPicks.forEach((pick, i) => {
            const area = allAreas[i];
            const teamName = teamNameMap[pick] || "";
            let bgColor = "#ffffff"; // Белый по умолчанию

            if (pick) {
                if (correctTeams[area].includes(pick)) {
                    bgColor = "#d1fae5"; // Светло-зеленый (Correct)
                } else {
                    bgColor = "#fee2e2"; // Светло-красный (Incorrect)
                }
            }

            html += `<td style="padding: 5px; background-color: ${bgColor};">${teamName}</td>`;
        });

        html += `</tr>`;
    });

    html += `</tbody></table></body></html>`;

    const blob = new Blob([html], { type: "application/vnd.ms-excel" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `pickem_colored_stats_${activeStage.name.replace(/\s/g, '_')}.xls`; 
    link.click();
    URL.revokeObjectURL(url);

  }, [sortedStats, teamNameMap, activeStage.name, correctTeams]);


  const generateCellData = useCallback((r, correctTeams, highlightEnabled, popularityEnabled, globalStatCounts) => {
    const allPicks = [
        ...r.three0.map((src, i) => ({ src, area: 'three0', idx: i, isCorrect: src && correctTeams.three0.includes(src), isEmpty: !src })),
        ...r.pass.map((src, i) => ({ src, area: 'pass', idx: i, isCorrect: src && correctTeams.pass.includes(src), isEmpty: !src })),
        ...r.out.map((src, i) => ({ src, area: 'out', idx: i, isCorrect: src && correctTeams.out.includes(src), isEmpty: !src })),
    ];

    if (!highlightEnabled && !popularityEnabled) return allPicks;

    const getPopularityScore = (src, area) => {
        if (!src || !globalStatCounts || !globalStatCounts[area]) return 0;
        return globalStatCounts[area][src] || 0;
    };

    const categorySort = (a, b) => {
        if (a.isEmpty && !b.isEmpty) return 1;
        if (!a.isEmpty && b.isEmpty) return -1;
        if (a.isEmpty && b.isEmpty) return 0;

        if (popularityEnabled) {
            const popA = getPopularityScore(a.src, a.area);
            const popB = getPopularityScore(b.src, b.area);
            if (popB !== popA) {
                return popB - popA; 
            }
        }

        if (highlightEnabled) {
            if (a.isCorrect && !b.isCorrect) return -1;
            if (!a.isCorrect && b.isCorrect) return 1;
        }

        return 0;
    };

    const sortedThree0 = allPicks.slice(0, 2).sort(categorySort);
    const sortedPass = allPicks.slice(2, 8).sort(categorySort);
    const sortedOut = allPicks.slice(8, 10).sort(categorySort);
    
    return [...sortedThree0, ...sortedPass, ...sortedOut];
}, []); 

  // --- Хелперы Сортировки ---
  
  const totalPlayers = stats.length;
  const getCategoryTotalPicks = (area, numPlayers) => {
    if (numPlayers === 0) return 1;
    switch (area) { case "three0": return numPlayers * 2; case "pass": return numPlayers * 6; case "out": return numPlayers * 2; default: return numPlayers; }
  };

  const categoryPopularity = useMemo(() => {
    const popularPicks = { three0: [], pass: [], out: [] };
    const unpopularPicks = { three0: [], pass: [], out: [] }; // NEW: Массив для непопулярных
    const categoryLimits = { three0: 2, pass: 6, out: 2 }; 

    for (const area of ['three0', 'pass', 'out']) {
        const counts = statCounts[area] || {};
        const denominator = totalPlayers > 0 ? totalPlayers : 1; 
        
        const sortedPicks = Object.entries(counts)
            .map(([src, count]) => ({
                src,
                count,
                teamName: teamNameMap[src] || "Неизвестно",
                percentage: (count / denominator) * 100,
                totalPicks: denominator
            }))
            .sort((a, b) => b.count - a.count);
        
        // --- Самые популярные (Top) ---
        popularPicks[area] = sortedPicks.slice(0, categoryLimits[area]);
        while (popularPicks[area].length < categoryLimits[area]) {
            popularPicks[area].push(null);
        }

        // --- Самые НЕпопулярные (Bottom) ---
        // Берем конец списка и реверсируем, чтобы самый редкий был первым
        let bottomList = [...sortedPicks].reverse().slice(0, categoryLimits[area]);
        unpopularPicks[area] = bottomList;
        while (unpopularPicks[area].length < categoryLimits[area]) {
            unpopularPicks[area].push(null);
        }
    }
    // Возвращаем оба набора
    return { popular: popularPicks, unpopular: unpopularPicks };
  }, [statCounts, totalPlayers, teamNameMap]);


  const requestSort = (key) => {
    let direction = sortConfig.direction === "descending" ? "ascending" : "descending";
    if (sortConfig.key !== key) direction = "descending";
    setSortConfig({ key, direction });
  };
  const getSortIcon = (key) => {
    if (sortConfig.key !== key) return <ArrowUpDown size={12} className="opacity-40" />;
    return <ChevronDown size={16} className={sortConfig.direction === "ascending" ? "rotate-180" : "" } />;
  };

  // --- Компонент Section ---
  const Section = ({ id, icon: Icon, title, children }) => (
    <div className="bg-neutral-800/70 border border-neutral-700 rounded-xl overflow-hidden shadow-lg">
      <button 
          className="w-full flex items-center justify-between px-4 py-3 text-left font-medium text-gray-200 hover:bg-neutral-700/80 transition" 
          onClick={() => setOpenSection(openSection === id ? null : id)}
      >
        <div className="flex items-center gap-2 text-orange-400">
            <Icon size={16} /> 
            <span className="text-white">{title}</span>
        </div>
        <ChevronDown size={16} className={`transition-transform ${openSection === id ? "rotate-180 text-orange-400" : ""}`} />
      </button>
      {openSection === id && <div className="p-4 space-y-4 border-t border-neutral-700 bg-neutral-900/40">{children}</div>}
    </div>
  );

  const getCellStyle = (cIdx) => cIdx < 2 ? "bg-green-500/25 border-green-500/40" : cIdx < 8 ? "bg-yellow-400/18 border-yellow-400/30" : cIdx < 10 ? "bg-red-500/25 border-red-500/40" : "";
  const nickStyle = { fontFamily: '"Halvar Breitschrift Regular", system-ui, -apple-system, Roboto, "Segoe UI", sans-serif' };
  
  const PopularPickCube = ({ pick, area }) => {
    const barColor = area === 'three0' ? 'rgb(34 197 94)' : area === 'pass' ? 'rgb(250 204 21)' : 'rgb(239 68 68)';
    const textColor = area === 'three0' ? 'text-green-400' : area === 'pass' ? 'text-yellow-400' : 'text-red-400';
    
    return (
        <div className="p-3 bg-black/20 rounded-lg border border-gray-700/50 min-w-28 h-full flex flex-col"> 
            {!pick ? (
                <div className="text-xs text-gray-500 h-full flex items-center justify-center">Нет данных</div>
            ) : (
                <>
                    <div>
                        <div className="flex items-center gap-2 mb-2 h-10">
                            <img src={pick.src} className="w-8 h-8 object-contain rounded flex-shrink-0" alt={pick.teamName} />
                            <span className="text-white text-sm font-semibold truncate leading-tight">{pick.teamName}</span>
                        </div>
                    </div>
                    <div>
                        <div className={`text-3xl font-extrabold ${textColor} leading-none`}>
                            {pick.percentage.toFixed(1)}%
                        </div>
                        <div className="text-xs text-gray-400 mt-1">
                            {pick.count} из {pick.totalPicks} (игроков)
                        </div>
                    </div>
                    <div className="relative h-2 rounded-full overflow-hidden bg-gray-700/50 mt-2">
                        <motion.div initial={{ width: 0 }} animate={{ width: `${pick.percentage}%` }} transition={{ duration: 0.5 }} className="h-full rounded-full" style={{ backgroundColor: barColor }} />
                    </div>
                </>
            )}
        </div>
    );
  };


  // =======================================================
  // --- РЕНДЕР КОМПОНЕНТА ---
  // =======================================================
  return (
    <div className="fixed inset-0 bg-[#0e0e14] text-white flex flex-col justify-start overflow-auto">
      <div className="flex flex-col md:flex-row gap-4 w-full max-w-[1800px] p-4">
        
        {/* --- ПАНЕЛЬ УПРАВЛЕНИЯ (СЛЕВА) --- */}
        <motion.aside initial={{ x: -50, opacity: 0 }} animate={{ x: 0, opacity: 1 }} transition={{ duration: 0.4 }} className="w-full md:w-80 bg-neutral-900/90 rounded-2xl p-4 flex-shrink-0 shadow-[0_0_20px_rgba(255,140,0,0.2)] space-y-4 border border-neutral-700">
          <h2 className="text-xl font-semibold text-orange-400 flex items-center gap-2 mb-4 pb-2 border-b border-orange-400/30"><Users size={18} /> Панель управления</h2>
          
          <Section id="config" icon={Settings} title="Управление данными">
            <p className="text-xs text-gray-400 mb-4">
                {fileHandle ? (
                    <span className="text-green-400 flex items-center gap-1"><Save size={12}/> Авто-запись в файл включена</span>
                ) : (
                    <span className="text-orange-300">Файл не выбран (Ctrl+S для выбора)</span>
                )}
            </p>
            <div className="space-y-3 p-3 bg-neutral-700/50 rounded-lg border border-neutral-600">
                <div className="grid grid-cols-[1fr_auto_auto] items-center gap-x-2">
                    <label className="text-sm font-semibold text-orange-400">Проект (Full)</label>
                    <button onClick={() => exportFullState(appState)} className="w-9 h-8 bg-green-600/80 text-white rounded hover:bg-green-500/90 transition flex items-center justify-center" title="Экспорт ВСЕГО проекта">
                            <Download size={16} />
                    </button>
                    <label className="w-9 h-8 bg-indigo-600/80 text-white rounded hover:bg-indigo-500/90 transition flex items-center justify-center cursor-pointer" title="Импорт ВСЕГО проекта">
                        <Upload size={16} />
                        <input type="file" accept="application/json,.pickemfull,.pickem" className="hidden" onChange={(e) => importData(e, setAppState, 'full')} />
                    </label>
                </div>
            </div>
            <div className="pt-4 border-t border-neutral-700/50 space-y-2">
                <div className="flex gap-2">
                    <button onClick={() => { if (window.confirm("Сбросить ВСЁ?")) { setAppState(INITIAL_STATE_BASE); localStorage.removeItem(STORAGE_KEY); setFileHandle(null); alert("Все данные сброшены."); } }} className="flex-1 h-8 bg-red-600/80 rounded-xl text-white hover:bg-red-500/90 transition flex items-center justify-center shadow-md" title="Сбросить ВСЁ"><Trash2 size={16} /></button>
                    <button onClick={() => { if (window.confirm("Сбросить дизайн?")) { setAppState(p => ({...p, bg: INITIAL_STATE_BASE.bg, bgImg: INITIAL_STATE_BASE.bgImg, bgScale: INITIAL_STATE_BASE.bgScale, bgPosX: INITIAL_STATE_BASE.bgPosX, bgPosY: INITIAL_STATE_BASE.bgPosY, verticalPad: INITIAL_STATE_BASE.verticalPad, horizontalPad: INITIAL_STATE_BASE.horizontalPad, borderRadius: INITIAL_STATE_BASE.borderRadius, tableOffsetY: INITIAL_STATE_BASE.tableOffsetY})); alert("Настройки дизайна сброшены."); } }} className="flex-1 h-8 bg-yellow-600/60 rounded-xl text-white hover:bg-yellow-500/80 transition flex items-center justify-center shadow-sm" title="Сбросить дизайн"><RotateCcw size={16} /></button>
                    <button onClick={quickSave} className={`flex-1 h-8 rounded-xl text-white transition flex items-center justify-center shadow-sm ${fileHandle ? 'bg-green-600/80 hover:bg-green-500' : 'bg-blue-600/80 hover:bg-blue-500'}`} title={fileHandle ? "Быстрое сохранение (Ctrl+S)" : "Сохранить проект как..."}>
                        {fileHandle ? <Save size={16} /> : <FolderOutput size={16} />}
                    </button>
                </div>
            </div>
          </Section>

          <div className="flex justify-between gap-2 p-2 bg-neutral-700/50 rounded-lg border border-neutral-600">
              <button onClick={undo} disabled={!canUndo} className={`flex-1 flex items-center justify-center gap-2 py-2 rounded-lg text-sm font-semibold transition ${canUndo ? 'bg-orange-600/80 hover:bg-orange-500/90 text-white' : 'bg-neutral-600/50 text-gray-500 cursor-not-allowed'}`}><RotateCcw size={16} /> (Ctrl+Z)</button>
              <button onClick={redo} disabled={!canRedo} className={`flex-1 flex items-center justify-center gap-2 py-2 rounded-lg text-sm font-semibold transition ${canRedo ? 'bg-orange-600/80 hover:bg-orange-500/90 text-white' : 'bg-neutral-600/50 text-gray-500 cursor-not-allowed'}`}>(Ctrl+Y) <RotateCw size={16} /></button>
          </div>
          
          <Section id="stages" icon={Layers} title="Управление этапами">
            <div className="space-y-2 max-h-64 overflow-y-auto">
                {stages.map((stage) => (
                    <StageItem key={stage.id} stage={stage} isActive={stage.id === activeStageId} isOnlyStage={stages.length <= 1} onSelect={setActiveStage} onRename={renameStage} onDelete={deleteStage} />
                ))}
            </div>
            <button onClick={addNewStage} className="mt-3 w-full bg-green-600/80 text-white py-2 rounded-lg text-sm font-semibold hover:bg-green-500/90 transition">Добавить новый этап</button>
          </Section>

          <Section id="rows" icon={Users} title="Количество строк (Этап)">
            <label className="block text-xs font-medium text-gray-300 mb-1">Количество игроков (1-30):</label>
            <input type="number" min="1" max="30" value={rowCount} onChange={(e) => setRowCount(e.target.value)} className="w-full text-white rounded px-2 py-1 bg-neutral-700 text-left focus:ring-1 focus:ring-orange-400 focus:border-orange-400 border-none" /> 
          </Section>

         <Section id="design" icon={Palette} title="Общий дизайн (Глобально)">
             <h3 className="text-sm font-semibold text-gray-300 mb-2 border-b border-neutral-600 pb-1">Фон и цвет</h3>
             <div className="space-y-4">
                <div>
                    <label className="block text-xs text-gray-300">Цвет фона:</label>
                    <input type="color" value={bg} onChange={(e) => setBg(e.target.value)} className="w-full h-8 rounded cursor-pointer mb-2" />
                    <label className="block text-xs text-gray-300">Фоновое изображение:</label>
                    <input type="file" accept="image/*" onChange={async (e) => { const f = e.target.files?.[0]; if (f) updateSingleValue('bgImg', (await readFileAsDataURL(f)).src); }} className="text-xs text-gray-300 file:mr-4 file:py-1 file:px-2 file:rounded-full file:border-0 file:text-sm file:font-semibold file:bg-neutral-600 file:text-white hover:file:bg-neutral-500" />
                    {bgImg && <button onClick={() => updateSingleValue('bgImg', "")} className="mt-2 text-xs text-red-400 hover:text-red-300 transition block">Сбросить фон</button>}
                </div>
                <div className="space-y-3">
                    <NumControl label="Масштаб (фон)" value={bgScale} setter={setBgScale} min={50} max={200} step={5} largeStep={10} unit="%" />
                    <NumControl label="Позиция X (фон)" value={bgPosX} setter={setBgPosX} min={0} max={100} step={1} largeStep={5} unit="%" />
                    <NumControl label="Позиция Y (фон)" value={bgPosY} setter={setBgPosY} min={0} max={100} step={1} largeStep={5} unit="%" />
                </div>
            </div>
             <h3 className="text-sm font-semibold text-gray-300 mb-2 mt-4 border-b border-neutral-600 pb-1">Отступы и сдвиг</h3>
             <div className="space-y-3">
                 <NumControl label="Вертикальные (внутр.)" value={verticalPad} setter={setVerticalPad} min={0} max={200} />
                 <NumControl label="Горизонтальные (внутр.)" value={horizontalPad} setter={setHorizontalPad} min={0} max={200} />
                 <NumControl label="Радиус углов" value={borderRadius} setter={setBorderRadius} min={0} max={50} largeStep={5} />
                 <div className="pt-2 border-t border-neutral-700/50">
                     <NumControl label="Вертикальный сдвиг блока пикемов" value={tableOffsetY} setter={setTableOffsetY} min={-300} max={300} />
                 </div>
             </div>
             <h3 className="text-sm font-semibold text-gray-300 mb-2 mt-4 border-b border-neutral-600 pb-1">Параметры отображения</h3>
             <div className="space-y-3">
                 <NumControl label="Ширина колонки имен" value={nickColWidth} setter={setNickColWidth} min={50} max={400} largeStep={10} />
                 <div className="flex items-center justify-between">
                    <label className="text-sm font-medium text-gray-300 pr-2">Включить аватарки</label>
                    <button onClick={() => setAvatarsEnabled((p) => !p)} className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors focus:outline-none ${avatarsEnabled ? "bg-orange-600" : "bg-neutral-600"}`}>
                        <span className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${avatarsEnabled ? "translate-x-6" : "translate-x-1"}`} />
                    </button>
                 </div>
                 <div className="flex items-start justify-between"> 
                    <label className="text-xs font-medium text-gray-300 pr-2 leading-tight max-w-[calc(100%-50px)]">Подсвечивать правильные</label>
                    <button onClick={() => setHighlightPicksEnabled((p) => !p)} className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors focus:outline-none ${highlightPicksEnabled ? "bg-green-600" : "bg-neutral-600"}`}>
                        <span className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${highlightPicksEnabled ? "translate-x-6" : "translate-x-1"}`} />
                    </button>
                 </div>
                 <div className="flex items-start justify-between"> 
                    <label className="text-xs font-medium text-gray-300 pr-2 leading-tight max-w-[calc(100%-50px)]">Сортировать по популярности</label>
                    <button onClick={() => setPopularitySortEnabled((p) => !p)} className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors focus:outline-none ${popularitySortEnabled ? "bg-blue-600" : "bg-neutral-600"}`}>
                        <span className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${popularitySortEnabled ? "translate-x-6" : "translate-x-1"}`} />
                    </button>
                 </div>
                 <div className="flex items-center justify-between pt-3 border-t border-neutral-700/50"> 
                    <label className="text-sm font-medium text-gray-300 pr-2 leading-tight">Прозрачный фон (PNG)</label>
                    <button onClick={() => updateSingleValue('transparentBackgroundEnabled', p => !p)} className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors focus:outline-none ${transparentBackgroundEnabled ? "bg-red-600" : "bg-neutral-600"}`}>
                        <span className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${transparentBackgroundEnabled ? "translate-x-6" : "translate-x-1"}`} />
                    </button>
                 </div>
                 
                 {/* КНОПКА ПОЛНОЭКРАННОГО РЕЖИМА */}
                 <div className="flex items-center justify-between pt-3 border-t border-neutral-700/50">
                    <label className="text-sm font-medium text-gray-300 pr-2 leading-tight">На весь экран</label>
                    <button onClick={toggleFullScreen} className="relative inline-flex items-center justify-center w-8 h-8 rounded bg-neutral-700 hover:bg-neutral-600 text-white transition focus:outline-none" title="Переключить полноэкранный режим">
                        {isFullScreen ? <Minimize size={16} /> : <Expand size={16} />}
                    </button>
                 </div>
             </div>
          </Section>
          
          <button onClick={addToStats} className="w-full bg-blue-600 py-3 rounded-xl font-semibold text-white hover:bg-blue-500 transition flex items-center justify-center gap-2 shadow-xl shadow-blue-900/50"><BarChart3 size={18} /> Добавить в статистику (Этап)</button>
          <button onClick={() => exportPNG(exportRef, 'pickem_table', false, transparentBackgroundEnabled)} className="w-full bg-orange-600 py-3 rounded-xl font-semibold text-white hover:bg-orange-500 transition flex items-center justify-center gap-2 shadow-xl shadow-orange-900/50"><Download size={18} /> Экспорт PNG (Этап)</button>

          <Section id="library" icon={Image} title="Библиотека Иконок (Глобально)">
            <input 
                type="file" 
                accept="image/*" 
                multiple 
                onChange={onIconUpload} 
                className="mb-4 text-xs text-gray-300 file:mr-4 file:py-1 file:px-2 file:rounded-full file:border-0 file:text-sm file:font-semibold file:bg-orange-500/90 file:text-white hover:file:bg-orange-400/90" 
            />
            <div ref={libraryRef} className="space-y-4 max-h-96 overflow-y-auto">
              {categorizedIcons.map((category) => (
                (category.id !== null || category.icons.length > 0) && (
                    <div key={category.id || 'null-category'}>
                        <div className="text-sm font-semibold text-orange-400 border-b border-neutral-600 pb-1 mb-2" onDrop={(e) => onDropOnCategory(e, category.id)} onDragOver={onDragOverCategory}>
                            {category.name} ({category.icons.length})
                        </div>
                        {category.icons.length > 0 ? (
                            <div className="grid grid-cols-4 gap-2">
                                {category.icons.map((it) => (
                                    <LibraryIconItem key={it.id} icon={it} onRename={renameIcon} onRemove={removeIcon} onDragStart={onDragStartIcon} onContextMenu={openIconContextMenu} />
                                ))}
                            </div>
                        ) : (
                            <div className="text-xs text-gray-500 text-center py-2 bg-neutral-800/50 rounded-lg" onDrop={(e) => onDropOnCategory(e, category.id)} onDragOver={onDragOverCategory}>Перетащите сюда иконки</div>
                        )}
                    </div>
                )
              ))}
              {library.length === 0 && <div className="col-span-4 text-center text-sm text-gray-400 py-4">Нет иконок. Загрузите их.</div>}
            </div>
          </Section>
        </motion.aside>
        
        {/* --- ОСНОВНОЙ КОНТЕНТ (ЦЕНТР) --- */}
        <div className="flex flex-col lg:flex-row gap-4 w-full items-start">
            <div ref={exportRef} className="relative z-10 border border-transparent bg-white/10 backdrop-blur-lg flex-shrink-0 w-full lg:w-auto" 
                style={{
                    backgroundColor: transparentBackgroundEnabled ? 'transparent' : bg,
                    backgroundImage: transparentBackgroundEnabled ? 'none' : (bgImg ? `url(${bgImg})` : "none"),
                    backgroundSize: `${getNumValue(bgScale)}%`,
                    backgroundPosition: `${getNumValue(bgPosX)}% ${getNumValue(bgPosY)}%`,
                    backgroundRepeat: "no-repeat",
                    padding: `${getNumValue(verticalPad)}px ${getNumValue(horizontalPad)}px`,
                    display: "flex",
                    justifyContent: "center",
                    alignItems: "flex-start",
                    borderRadius: `${getNumValue(borderRadius)}px`,
                    boxShadow: "0 0 40px rgba(255,165,0,0.2)",
                }}
            >
                <div className="bg-white/10 backdrop-blur-md p-4 border border-orange-400/40 shadow-[0_0_20px_rgba(255,165,0,0.3)] inline-block rounded-lg" style={{ transform: `translateY(${getNumValue(tableOffsetY)}px)` }}>
                    {rows.map((r, rIdx) => {
                        const cellDataArray = generateCellData(r, correctTeams, highlightPicksEnabled, popularitySortEnabled, statCounts);
                        const currentFontSize = r.nickFontSize || 14;
                        return (
                        <div key={r.id} className="flex items-center gap-3 mb-1 group relative">
                            <div className={`w-10 h-10 rounded overflow-hidden flex items-center justify-center relative group ${avatarsEnabled ? 'bg-white/10' : 'bg-gray-700/50'}`}>
                                {avatarsEnabled ? (
                                    r.avatar ? (
                                        <div className="w-full h-full relative cursor-pointer" style={{ backgroundImage: `url(${r.avatar})`, backgroundSize: `${r.avatarScale || 100}%`, backgroundPosition: `${r.avatarPosX || 50}% ${r.avatarPosY || 50}%`, backgroundRepeat: 'no-repeat', transition: 'background-size 0.3s, background-position 0.3s' }} onClick={() => openAvatarEditor(rIdx)} role="button" tabIndex={0} onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") openAvatarEditor(rIdx); }}>
                                            <button onClick={(e) => { e.stopPropagation(); setRows((rs) => rs.map((row, i) => (i === rIdx ? { ...row, avatar: "" } : row))); }} className="absolute top-0 right-0 bg-red-600/70 text-white p-0.5 rounded-bl opacity-0 group-hover:opacity-100 transition-opacity z-10" title="Удалить аватар"><X size={10} /></button>
                                            <button onClick={(e) => { e.stopPropagation(); openAvatarEditor(rIdx); }} className="absolute bottom-0 left-0 bg-orange-600/70 text-white p-0.5 rounded-tr opacity-0 group-hover:opacity-100 transition-opacity z-10 text-xs" title="Редактировать аватар"><Maximize size={10} /></button>
                                        </div>
                                    ) : (
                                        <label className="text-xs cursor-pointer text-gray-400 hover:text-white transition">+<input type="file" accept="image/*" className="hidden" onChange={(e) => onAvatarUpload(e, rIdx)} /></label>
                                    )
                                ) : (<span className="text-sm font-bold text-orange-300">{rIdx + 1}</span>)}
                            </div>
                            <input style={{ ...nickStyle, fontSize: `${currentFontSize}px`, width: `${nickColWidth}px` }} className="text-white text-left focus:outline-none bg-transparent transition-all duration-200" value={r.nick} onChange={(e) => setRows((rs) => rs.map((row, i) => (i === rIdx ? { ...row, nick: e.target.value } : row)))} onWheel={(e) => handleNickScroll(e, rIdx)} title="Крутите колесико, чтобы изменить размер шрифта" />
                            <div className="relative flex items-center bg-black/30 rounded-lg p-1 border border-white/10 gap-[3px]">
                                <div className="absolute top-0 bottom-0 left-0 -translate-x-full w-3 flex flex-col items-center justify-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
                                    <button onClick={() => moveRow(rIdx, -1)} disabled={rIdx === 0} className="text-gray-400 hover:text-white disabled:opacity-30 disabled:cursor-not-allowed"><ChevronUp size={10} /></button>
                                    <button onClick={() => moveRow(rIdx, 1)} disabled={rIdx === rows.length - 1} className="text-gray-400 hover:text-white disabled:opacity-30 disabled:cursor-not-allowed"><ChevronDown size={10} /></button>
                                </div>
                                {cellDataArray.map((cellObj, ci) => {
                                    const { src: cell, area, idx } = cellObj;
                                    const isCorrect = highlightPicksEnabled && cell && correctTeams[area]?.includes(cell);
                                    const isIncorrect = highlightPicksEnabled && cell && !correctTeams[area]?.includes(cell);
                                    return (
                                        <div key={ci} ref={picker.target?.rIdx === rIdx && picker.target?.cIdx === idx && picker.target?.area === area ? pickerRef : null} onDragOver={onDragOverCell} onDrop={(e) => onDrop(e, rIdx, area, idx)} onClick={(e) => openPicker(rIdx, area, idx, cell, e.currentTarget)} role="button" tabIndex={0} onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") openPicker(rIdx, area, idx, cell, e.currentTarget); }} className={`w-10 h-10 rounded flex items-center justify-center border hover:scale-105 transition cursor-pointer ${getCellStyle(ci)} ${isIncorrect ? 'opacity-30 grayscale' : ''} ${isCorrect ? 'ring-2 ring-green-400' : ''}`}>
                                            {cell ? <img src={cell} draggable onDragStart={(e) => onDragStartIcon(e, { src: cell, id: null })} onDragEnd={onDragEnd} className="w-8 h-8 object-contain" alt={`cell-${rIdx}-${ci}`} style={{ WebkitUserDrag: "element" }} /> : <div className="text-xs text-gray-400">+</div>}
                                        </div>
                                    );
                                })}
                                <div className="absolute top-0 bottom-0 right-0 translate-x-full w-3 flex flex-col items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity">
                                    <button onClick={() => clearRowPicks(rIdx)} className="text-red-500/70 hover:text-red-400" title="Очистить пикемы и ник"><Trash2 size={10} /></button>
                                </div>
                            </div>
                        </div>
                        );
                    })}
                </div>
            </div>

            {/* --- СТАТИСТИКА --- */}
            <div className="flex-1 w-full mt-4 lg:mt-0 min-w-80">
                <div ref={statsRef} className={`w-full h-fit min-h-min p-4 rounded-lg border border-orange-400/40 shadow-lg ${statsTransparent ? '' : 'bg-neutral-900/90'}`}>
                    <h3 className="text-lg font-semibold mb-2 flex items-center gap-2"><BarChart3 size={18} /> Статистика Pick'em (Этап: {activeStage.name})</h3>
                    
                    <div className="mb-3 export-exclude">
                        <div className="text-sm text-gray-300 mb-1">Отметьте **правильные команды** (для этого этапа):</div>
                        <div className="flex gap-4">
                            {["three0", "pass", "out"].map((area) => (
                                <div key={area} className="flex-1">
                                    <div className="text-xs text-orange-300 mb-1 capitalize">{getAreaTitle(area)}</div>
                                    <div className="flex gap-2 flex-wrap bg-black/20 p-2 rounded">
                                        {library.map((it) => {
                                            const active = correctTeams[area]?.includes(it.src);
                                            return (
                                                <button key={it.id} onClick={() => toggleCorrect(area, it.src)} className={`w-10 h-10 rounded overflow-hidden p-0.5 border ${active ? "ring-2 ring-green-400" : "opacity-80"}`}>
                                                    <img src={it.src} className="w-full h-full object-contain" alt={it.id} />
                                                </button>
                                            );
                                        })}
                                    </div>
                                </div>
                            ))}
                        </div>
                    </div>
                    
                    <div className="flex items-center gap-2 mb-3 mt-4 pt-3 border-t border-gray-600/40 flex-wrap export-exclude">
                        {/* Уменьшенные кнопки экспорта */}
                        <button onClick={exportColoredExcel} className="bg-green-600/90 py-0.5 px-2 rounded text-xs hover:bg-green-500 transition flex items-center gap-1 border border-green-500/50 shadow-sm" title="Скачать таблицу (Excel)">
                            <FileSpreadsheet size={12}/> Excel
                        </button>
                        <button onClick={() => exportPNG(statsRef, 'pickem_stats_public', true, statsTransparent)} className="bg-orange-600/90 py-0.5 px-2 rounded text-xs hover:bg-orange-500 transition flex items-center gap-1 border border-orange-500/50 shadow-sm">
                            <Image size={12}/> PNG
                        </button>

                        {/* Переключатель прозрачности */}
                        <div className="flex items-center gap-2 ml-2 bg-black/20 px-2 py-1 rounded border border-white/5">
                            <label className="text-[10px] text-gray-400 cursor-pointer select-none uppercase font-bold tracking-wider" htmlFor="stats-transparent-toggle">PNG Фон</label>
                            <button id="stats-transparent-toggle" onClick={() => setStatsTransparent((p) => !p)} className={`relative inline-flex h-3 w-6 items-center rounded-full transition-colors focus:outline-none ${statsTransparent ? "bg-blue-600" : "bg-neutral-600"}`}>
                                <span className={`inline-block h-2 w-2 transform rounded-full bg-white transition-transform ${statsTransparent ? "translate-x-3" : "translate-x-0.5"}`} />
                            </button>
                        </div>

                        {/* Поиск по таблице (НОВОЕ) */}
                        <div className="relative ml-1">
                            <Search size={12} className="absolute left-2 top-1/2 -translate-y-1/2 text-gray-500" />
                            <input 
                                type="text"
                                value={statsSearch}
                                onChange={(e) => setStatsSearch(e.target.value)}
                                placeholder="Поиск игрока..."
                                className="bg-black/20 text-white text-xs rounded-full pl-7 pr-2 py-1 border border-neutral-700 focus:border-orange-400 outline-none w-28 focus:w-40 transition-all placeholder:text-gray-600"
                            />
                             {statsSearch && (
                                <button onClick={() => setStatsSearch("")} className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-500 hover:text-white">
                                    <X size={10} />
                                </button>
                            )}
                        </div>

                        <button onClick={clearStats} className="text-red-500/60 hover:text-red-400 text-xs ml-auto flex items-center gap-1 py-1 px-2 rounded hover:bg-red-900/20 transition" title="Очистить всю статистику">
                            <Trash2 size={12} /> Сброс
                        </button>
                    </div>

                    {stats.length === 0 ? (
                        <div className="text-sm text-gray-400">Статистика для этого этапа пока пуста.</div>
                    ) : (
                        <>
                            <div className="overflow-x-auto">
                                <table className="w-full text-sm border-collapse mb-3" style={{ tableLayout: "fixed", minWidth: "720px" }}>
                                    <thead>
                                        <tr className="text-left text-orange-300 border-b border-orange-400/40">
                                            <th className="p-1 pl-9 w-40 min-w-40"><button onClick={() => requestSort("nick")} className="flex items-center gap-1 font-semibold text-left">Игрок {getSortIcon("nick")}</button></th>
                                            <th className="p-1 w-28 text-center">{getAreaTitle('three0')}</th>
                                            <th className="p-1 w-64 text-center">{getAreaTitle('pass')}</th>
                                            <th className="p-1 w-28 text-center">{getAreaTitle('out')}</th>
                                            <th className="p-1 w-16 text-center"><button onClick={() => requestSort("score")} className="flex items-center justify-center gap-1 font-semibold text-center w-full">Счет {getSortIcon("score")}</button></th>
                                            <th className="p-1 w-10"></th> 
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {sortedStats.map((r) => (
                                            <tr key={r.id} className="border-b border-white/10 group">
                                                <td className="p-1 align-top" style={{ ...nickStyle, fontSize: '14px' }}>
                                                    <div className="flex items-center justify-start gap-2 h-8 w-full relative">
                                                        <button onClick={() => restoreRowFromStats(r)} className="opacity-0 group-hover:opacity-100 transition-opacity text-blue-400 hover:text-blue-300 flex-shrink-0" title="Вернуть в таблицу"><ArrowUpFromLine size={14} /></button>
                                                        {editingStatId === r.id ? (
                                                            <input 
                                                                autoFocus
                                                                value={r.nick} 
                                                                onChange={(e) => updateStatNick(r.id, e.target.value)} 
                                                                onBlur={() => setEditingStatId(null)}
                                                                onKeyDown={(e) => { if(e.key === 'Enter') setEditingStatId(null); }}
                                                                className="bg-black/40 border border-orange-400/50 focus:outline-none text-white w-full rounded px-1 h-full text-sm" 
                                                            />
                                                        ) : (
                                                            <HighlightedText text={r.nick} highlight={statsSearch} onClick={() => setEditingStatId(r.id)} />
                                                        )}
                                                    </div>
                                                </td>
                                                {["three0", "pass", "out"].map((area) => (
                                                    <td key={area} className="p-1 align-middle">
                                                        <div className="flex gap-1 flex-wrap justify-center items-center h-full">
                                                            {Array.isArray(r[area]) && r[area].map((t, i) => t ? <img key={i} src={t} className={`w-6 h-6 object-contain rounded ${correctTeams[area].includes(t) ? "ring-2 ring-green-400" : "opacity-40"}`} alt={teamNameMap[t] || "Pick"} /> : <div key={i} className="w-6 h-6 inline-block" />)}
                                                        </div>
                                                    </td>
                                                ))}
                                                <td className="p-1 align-middle text-center font-bold text-lg"><span className="flex items-center justify-center gap-1 text-green-400 h-full">{r.score}</span></td>
                                                <td className="p-1 align-middle text-center">
                                                    <button onClick={() => deleteStatItem(r.id)} className="opacity-0 group-hover:opacity-100 transition text-red-500/60 hover:text-red-400 p-1" title="Удалить"><Trash2 size={14} /></button>
                                                </td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </div>
                            
                            {/* --- Частоты Выборов (Сворачиваемый блок) --- */}
                            <div className="mt-4 text-sm text-gray-300 export-exclude relative">
                                <div className="mb-2 font-semibold border-b border-gray-600/40 pb-1 flex justify-between items-center">
                                    <span>Частоты выборов (Этап):</span>
                                    <button onClick={() => setFrequenciesExpanded(!frequenciesExpanded)} className="text-xs flex items-center gap-1 text-blue-400 hover:text-blue-300 transition">
                                        {frequenciesExpanded ? <><ChevronsUp size={14}/> Свернуть</> : <><ChevronsDown size={14}/> Показать все</>}
                                    </button>
                                </div>
                                <div className={`relative overflow-hidden transition-all duration-500 ease-in-out ${frequenciesExpanded ? 'max-h-[5000px]' : 'max-h-64'}`}>
                                    <div className="grid grid-cols-1 md:grid-cols-3 gap-4 pb-2">
                                        {Object.entries(statCounts).map(([area, counts]) => {
                                            const areaTotalPicks = getCategoryTotalPicks(area, totalPlayers);
                                            return (
                                                <div key={area} className="space-y-3 bg-black/20 p-3 rounded-lg border border-gray-700/50 h-fit">
                                                    <div className="font-bold text-orange-400 capitalize text-base border-b border-gray-600/50 pb-1">{getAreaTitle(area)}</div>
                                                    <div className="space-y-2">
                                                        {Object.entries(counts).sort((a, b) => b[1] - a[1]).map(([src, c]) => {
                                                                const percentage = (c / areaTotalPicks) * 100;
                                                                const teamName = teamNameMap[src] || "Неизвестно";
                                                                const isHigh = percentage > 30; 
                                                                const barColor = isHigh ? 'rgb(251 146 60)' : 'rgb(59 130 246)'; 
                                                                return (
                                                                    <div key={src} className="pb-1 border-b border-gray-700/40 last:border-b-0">
                                                                        <div className="flex justify-between items-center text-xs mb-1">
                                                                            <div className="flex items-center gap-1.5 min-w-0 flex-1">
                                                                                <img src={src} className="w-5 h-5 object-contain rounded flex-shrink-0" alt={teamName} />
                                                                                <span className="text-white truncate font-medium">{teamName}</span>
                                                                                <span className="font-bold text-orange-400/80 ml-1 flex-shrink-0">({c})</span>
                                                                            </div>
                                                                            <span className={`font-semibold flex-shrink-0 ${isHigh ? 'text-orange-300' : 'text-gray-300'}`}>{percentage.toFixed(1)}%</span>
                                                                        </div>
                                                                        <div className="relative h-2 rounded-full overflow-hidden bg-gray-700/50">
                                                                            <motion.div initial={{ width: 0 }} animate={{ width: `${percentage}%` }} transition={{ duration: 0.5 }} className="h-full rounded-full" style={{ backgroundColor: barColor }} />
                                                                        </div>
                                                                    </div>
                                                                );
                                                            })}
                                                    </div>
                                                </div>
                                            );
                                        })}
                                    </div>
                                    {/* Градиентное затемнение при свернутом состоянии */}
                                    {!frequenciesExpanded && (
                                        <div className="absolute bottom-0 left-0 w-full h-20 bg-gradient-to-t from-neutral-900/90 via-neutral-900/60 to-transparent pointer-events-none" />
                                    )}
                                </div>
                            </div>

                            {/* --- Самые Популярные Выборы --- */}
                            <div className="mt-6 text-sm text-gray-300">
                                <div className="mb-3 font-semibold border-b border-orange-400/40 pb-1 text-orange-400 flex items-center justify-between">
                                    <div className="flex items-center gap-1"><Users size={16} /> Самые популярные выборы по категориям (Этап)</div>
                                </div>
                                <div className="grid grid-cols-5 gap-2 grid-rows-[auto_1fr_1fr] mb-6">
                                    <div className="text-xs font-semibold text-green-400 h-4 text-center" style={nickStyle}>3-0</div>
                                    <div className="text-xs font-semibold text-yellow-400 h-4 text-center col-span-3" style={nickStyle}>ПРОХОД</div>
                                    <div className="text-xs font-semibold text-red-400 h-4 text-center" style={nickStyle}>0-3</div>

                                    <PopularPickCube pick={categoryPopularity.popular.three0[0]} area="three0" />
                                    <PopularPickCube pick={categoryPopularity.popular.pass[0]} area="pass" />
                                    <PopularPickCube pick={categoryPopularity.popular.pass[1]} area="pass" />
                                    <PopularPickCube pick={categoryPopularity.popular.pass[2]} area="pass" />
                                    <PopularPickCube pick={categoryPopularity.popular.out[0]} area="out" />
                                    
                                    <PopularPickCube pick={categoryPopularity.popular.three0[1]} area="three0" />
                                    <PopularPickCube pick={categoryPopularity.popular.pass[3]} area="pass" />
                                    <PopularPickCube pick={categoryPopularity.popular.pass[4]} area="pass" />
                                    <PopularPickCube pick={categoryPopularity.popular.pass[5]} area="pass" />
                                    <PopularPickCube pick={categoryPopularity.popular.out[1]} area="out" />
                                </div>

                                {/* --- Самые НЕпопулярные Выборы --- */}
                                <div className="mb-3 font-semibold border-b border-red-400/40 pb-1 text-red-400 flex items-center justify-between">
                                    <div className="flex items-center gap-1"><ThumbsDown size={16} /> Самые непопулярные выборы по категориям (Этап)</div>
                                </div>
                                <div className="grid grid-cols-5 gap-2 grid-rows-[auto_1fr_1fr]">
                                    <div className="text-xs font-semibold text-green-400 h-4 text-center" style={nickStyle}>3-0</div>
                                    <div className="text-xs font-semibold text-yellow-400 h-4 text-center col-span-3" style={nickStyle}>ПРОХОД</div>
                                    <div className="text-xs font-semibold text-red-400 h-4 text-center" style={nickStyle}>0-3</div>

                                    <PopularPickCube pick={categoryPopularity.unpopular.three0[0]} area="three0" />
                                    <PopularPickCube pick={categoryPopularity.unpopular.pass[0]} area="pass" />
                                    <PopularPickCube pick={categoryPopularity.unpopular.pass[1]} area="pass" />
                                    <PopularPickCube pick={categoryPopularity.unpopular.pass[2]} area="pass" />
                                    <PopularPickCube pick={categoryPopularity.unpopular.out[0]} area="out" />
                                    
                                    <PopularPickCube pick={categoryPopularity.unpopular.three0[1]} area="three0" />
                                    <PopularPickCube pick={categoryPopularity.unpopular.pass[3]} area="pass" />
                                    <PopularPickCube pick={categoryPopularity.unpopular.pass[4]} area="pass" />
                                    <PopularPickCube pick={categoryPopularity.unpopular.pass[5]} area="pass" />
                                    <PopularPickCube pick={categoryPopularity.unpopular.out[1]} area="out" />
                                </div>
                            </div>
                        </>
                    )}
                </div>
            </div>
        </div>
      </div>

  {/* --- Модальное окно Picker (Компактное: 8 колонок, с поиском) --- */}
      {picker.open && picker.target && (
        <div className="fixed inset-0 z-50" onMouseDown={(e) => { if (pickerRef.current && !pickerRef.current.contains(e.target) && e.target !== pickerRef.current) closePicker(); }}>
          <div ref={pickerRef} className="absolute bg-neutral-800 border border-neutral-600 rounded-xl p-2 shadow-2xl z-50 flex flex-col gap-2" 
               style={{ 
                   top: picker.position.top, 
                   left: picker.position.left, 
                   transform: `translateX(-50%)`, 
                   width: "90vw", 
                   maxWidth: "380px", 
                   maxHeight: "350px" 
               }}>
            
            <div className="flex items-center justify-between border-b border-neutral-600 pb-1 px-1">
              <span className="font-semibold text-[11px] text-orange-400 uppercase tracking-wide">Выберите команду</span>
              <button onClick={closePicker} className="text-gray-400 hover:text-white"><X size={14}/></button>
            </div>

            <div className="relative px-0.5">
                <Search size={12} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-500" />
                <input 
                    type="text" 
                    placeholder="Поиск..." 
                    autoFocus 
                    value={pickerSearch} 
                    onChange={(e) => setPickerSearch(e.target.value)} 
                    className="w-full bg-neutral-900 text-white text-[11px] rounded pl-7 pr-2 py-1 border border-neutral-700 focus:border-orange-400 outline-none placeholder:text-gray-600" 
                />
            </div>

            {picker.target.currentIconSrc && (
              <button onClick={() => selectIconForCell("REMOVE_ICON")} className="mx-0.5 flex items-center justify-center gap-1.5 bg-red-900/30 text-red-400 hover:bg-red-900/50 py-1 rounded text-[10px] font-semibold transition border border-red-900/50">
                  <SquareX size={12} /> Очистить слот
              </button>
            )}
            
            <div className="overflow-y-auto flex-1 px-0.5 min-h-[100px] content-start space-y-2 custom-scrollbar">
              {filteredCategorizedIcons.length === 0 ? (
                <div className="text-center text-gray-500 text-[10px] py-6">Ничего не найдено</div>
              ) : (
                filteredCategorizedIcons.map((category) => (
                    <div key={category.id || 'picker-cat-null'}>
                        <div className="text-[10px] font-bold text-gray-500 mb-0.5 uppercase tracking-wider px-1 mt-1 border-b border-neutral-700/50">
                            {category.name}
                        </div>
                        <div className="grid grid-cols-8 gap-0.5">
                            {category.icons.map((it) => (
                                <button key={it.id} onClick={() => selectIconForCell(it.src)} className="aspect-square bg-neutral-700/40 rounded hover:bg-neutral-600 hover:ring-1 hover:ring-orange-400 transition flex items-center justify-center p-0.5 relative group" title={it.name}>
                                    <img src={it.src} alt={it.name} className="w-full h-full object-contain" draggable={false} />
                                </button>
                            ))}
                        </div>
                    </div>
                ))
              )}
            </div>
          </div>
        </div>
      )}

      {/* --- Модальное окно Аватара --- */}
      {avatarEditor.open && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70">
              <div className="bg-neutral-800 border border-neutral-600 rounded-xl p-6 shadow-2xl w-full max-w-lg space-y-4">
                  <h3 className="text-xl font-semibold text-orange-400 border-b border-neutral-600 pb-2">Настройка аватара</h3>
                  <div className="w-full aspect-square rounded-lg overflow-hidden border border-neutral-600 bg-black flex items-center justify-center">
                      <div className="w-64 h-64 rounded-full overflow-hidden border-2 border-orange-400"
                          style={{ backgroundImage: `url(${avatarEditor.src})`, backgroundSize: `${avatarEditor.scale}%`, backgroundPosition: `${avatarEditor.posX}% ${avatarEditor.posY}%`, backgroundRepeat: 'no-repeat', transition: 'background-size 0.1s, background-position 0.1s' }}
                      />
                  </div>
                  <div className="space-y-3">
                      <NumControl label={`Зум/Масштаб: ${avatarEditor.scale}%`} value={avatarEditor.scale} setter={setAvatarEditorValue('scale')} min={50} max={400} largeStep={10} unit="%" />
                      <NumControl label={`Позиция X: ${avatarEditor.posX}%`} value={avatarEditor.posX} setter={setAvatarEditorValue('posX')} min={0} max={100} largeStep={5} unit="%" />
                      <NumControl label={`Позиция Y: ${avatarEditor.posY}%`} value={avatarEditor.posY} setter={setAvatarEditorValue('posY')} min={0} max={100} largeStep={5} unit="%" />
                  </div>
                  <div className="flex justify-end gap-3 pt-2">
                      <button onClick={closeAvatarEditor} className="px-4 py-2 bg-neutral-700 rounded-lg text-sm hover:bg-neutral-600 transition">Отмена</button>
                      <button onClick={saveAvatarSettings} className="px-4 py-2 bg-orange-600 rounded-lg text-sm font-semibold hover:bg-orange-500 transition">Сохранить</button>
                  </div>
              </div>
          </div>
      )}

      {/* --- Контекстное меню --- */}
      {iconContextMenu.open && (
          <div className="fixed bg-neutral-800 border border-neutral-600 rounded-lg shadow-2xl z-50 p-2 space-y-1 w-48" style={{ top: iconContextMenu.y, left: iconContextMenu.x }} onClick={(e) => e.stopPropagation()} onMouseDown={(e) => e.stopPropagation()} onContextMenu={(e) => { e.preventDefault(); e.stopPropagation(); }}>
              <div className="text-xs text-gray-400 px-2 pb-1 border-b border-neutral-600 mb-1">Переместить в...</div>
              <button onClick={() => { moveIconToCategory(iconContextMenu.iconId, null); closeIconContextMenu(); }} className="w-full text-left text-sm text-white hover:bg-neutral-700 rounded px-2 py-1">Без категории</button>
              {libraryCategories.map(category => (
                  <button key={category.id} onClick={() => { moveIconToCategory(iconContextMenu.iconId, category.id); closeIconContextMenu(); }} className="w-full text-left text-sm text-white hover:bg-neutral-700 rounded px-2 py-1">{category.name}</button>
              ))}
          </div>
      )}
    </div>
  );
}