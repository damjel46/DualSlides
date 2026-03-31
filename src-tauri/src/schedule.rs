use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::sync::{Arc, Mutex};
use tokio_util::sync::CancellationToken;

// ── Types ────────────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ScheduleSlot {
    pub name: String,
    pub start_time: String, // "HH:MM" 24h format
    pub end_time: String,   // "HH:MM" 24h format
    /// Optional profile ID for future integration
    pub profile_id: Option<String>,
    /// Direct folder mapping: monitor_id → vec of folder paths
    pub folders: HashMap<String, Vec<String>>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Schedule {
    pub enabled: bool,
    pub slots: Vec<ScheduleSlot>,
}

impl Default for Schedule {
    fn default() -> Self {
        Self {
            enabled: false,
            slots: vec![
                ScheduleSlot {
                    name: "Day".into(),
                    start_time: "06:00".into(),
                    end_time: "18:00".into(),
                    profile_id: None,
                    folders: HashMap::new(),
                },
                ScheduleSlot {
                    name: "Night".into(),
                    start_time: "18:00".into(),
                    end_time: "06:00".into(),
                    profile_id: None,
                    folders: HashMap::new(),
                },
            ],
        }
    }
}

// ── Engine ────────────────────────────────────────────────────────────

pub struct ScheduleEngine {
    schedule: Arc<Mutex<Schedule>>,
    active_slot_index: Arc<Mutex<Option<usize>>>,
    cancel_token: Arc<Mutex<Option<CancellationToken>>>,
}

impl ScheduleEngine {
    pub fn new() -> Self {
        Self {
            schedule: Arc::new(Mutex::new(Schedule::default())),
            active_slot_index: Arc::new(Mutex::new(None)),
            cancel_token: Arc::new(Mutex::new(None)),
        }
    }

    pub fn get_schedule(&self) -> Schedule {
        self.schedule.lock().unwrap().clone()
    }

    pub fn set_schedule(&self, schedule: Schedule) {
        let was_enabled = {
            let old = self.schedule.lock().unwrap();
            old.enabled
        };
        let is_enabled = schedule.enabled;
        *self.schedule.lock().unwrap() = schedule;

        // If schedule was just disabled, stop timer
        if was_enabled && !is_enabled {
            self.stop_timer();
        }
    }

    pub fn enable(&self, enabled: bool) {
        self.schedule.lock().unwrap().enabled = enabled;
        if !enabled {
            self.stop_timer();
        }
    }

    pub fn get_active_slot(&self) -> Option<String> {
        let idx = *self.active_slot_index.lock().unwrap();
        let schedule = self.schedule.lock().unwrap();
        idx.and_then(|i| schedule.slots.get(i).map(|s| s.name.clone()))
    }

    /// Find which slot is active for the given time (HH:MM).
    /// Each slot has start_time and end_time. Supports overnight ranges
    /// (e.g. start=22:00, end=06:00 means 22:00→next day 06:00).
    fn find_active_slot(slots: &[ScheduleSlot], now_hhmm: &str) -> Option<usize> {
        if slots.is_empty() {
            return None;
        }

        for (i, slot) in slots.iter().enumerate() {
            let start = slot.start_time.as_str();
            let end = slot.end_time.as_str();

            if start == end {
                // 24h slot (same start/end = always active)
                return Some(i);
            } else if start < end {
                // Normal range: e.g. 06:00 ~ 18:00
                if now_hhmm >= start && now_hhmm < end {
                    return Some(i);
                }
            } else {
                // Overnight range: e.g. 18:00 ~ 06:00
                if now_hhmm >= start || now_hhmm < end {
                    return Some(i);
                }
            }
        }

        None
    }

    /// Start the schedule check timer. Checks every 30 seconds.
    /// When a slot transition is detected, emits "schedule-slot-changed"
    /// event via the AppHandle.
    pub fn start_timer(&self, app: tauri::AppHandle) {
        self.stop_timer();

        let token = CancellationToken::new();
        *self.cancel_token.lock().unwrap() = Some(token.clone());

        let schedule = self.schedule.clone();
        let active_idx = self.active_slot_index.clone();

        // Apply current slot immediately
        {
            let sched = schedule.lock().unwrap();
            if sched.enabled && !sched.slots.is_empty() {
                let now = chrono_now_hhmm();
                let idx = Self::find_active_slot(&sched.slots, &now);
                *active_idx.lock().unwrap() = idx;

                if let Some(i) = idx {
                    if let Some(slot) = sched.slots.get(i) {
                        log::info!("Schedule: initial slot '{}' ({})", slot.name, slot.start_time);
                        let _ = app.emit("schedule-slot-changed", SlotChangedPayload {
                            slot_index: i,
                            slot_name: slot.name.clone(),
                            folders: slot.folders.clone(),
                        });
                    }
                }
            }
        }

        tauri::async_runtime::spawn(async move {
            let mut ticker = tokio::time::interval(tokio::time::Duration::from_secs(30));
            ticker.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Skip);

            loop {
                tokio::select! {
                    _ = ticker.tick() => {}
                    _ = token.cancelled() => { break; }
                }
                if token.is_cancelled() { break; }

                let sched = schedule.lock().unwrap().clone();
                if !sched.enabled || sched.slots.is_empty() {
                    continue;
                }

                let now = chrono_now_hhmm();
                let new_idx = Self::find_active_slot(&sched.slots, &now);
                let old_idx = *active_idx.lock().unwrap();

                if new_idx != old_idx {
                    *active_idx.lock().unwrap() = new_idx;
                    if let Some(i) = new_idx {
                        if let Some(slot) = sched.slots.get(i) {
                            log::info!("Schedule: switching to '{}' ({})", slot.name, slot.start_time);
                            let _ = app.emit("schedule-slot-changed", SlotChangedPayload {
                                slot_index: i,
                                slot_name: slot.name.clone(),
                                folders: slot.folders.clone(),
                            });
                        }
                    }
                }
            }

            log::info!("Schedule timer stopped");
        });
    }

    fn stop_timer(&self) {
        let mut token = self.cancel_token.lock().unwrap();
        if let Some(t) = token.take() {
            t.cancel();
        }
        *self.active_slot_index.lock().unwrap() = None;
    }
}

// ── Event payload ────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SlotChangedPayload {
    pub slot_index: usize,
    pub slot_name: String,
    pub folders: HashMap<String, Vec<String>>,
}

// ── Time helper ──────────────────────────────────────────────────────

fn chrono_now_hhmm() -> String {
    #[cfg(target_os = "windows")]
    {
        use windows::Win32::System::SystemInformation::GetLocalTime;
        let st = unsafe { GetLocalTime() };
        return format!("{:02}:{:02}", st.wHour, st.wMinute);
    }

    #[cfg(not(target_os = "windows"))]
    {
        let now = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap_or_default()
            .as_secs();
        let secs_in_day = now % 86400;
        let hours = secs_in_day / 3600;
        let minutes = (secs_in_day % 3600) / 60;
        return format!("{:02}:{:02}", hours, minutes);
    }
}

use tauri::Emitter;
