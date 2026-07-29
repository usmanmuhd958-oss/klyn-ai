use crossbeam_queue::ArrayQueue;
use once_cell::sync::Lazy;
use parking_lot::RwLock;
use std::collections::HashMap;
use std::sync::atomic::{AtomicBool, AtomicU32, AtomicU64, Ordering};
use std::sync::Arc;
use std::thread;
use std::time::Instant;

const PRIORITY_LEVELS: usize = 8;
const QUEUE_CAPACITY: usize = 4096;
const MAX_AGENTS: usize = 256;
const RSS_LIMIT_BYTES: usize = 3_932_160;

#[repr(C)]
#[derive(Clone, Copy)]
struct Task {
    task_id: u64,
    priority: u8,
    agent_id_hash: u64,
    enqueue_time_ns: u64,
}

#[repr(C)]
struct Agent {
    id: String,
    pid: u32,
    state: AtomicU32,
    rss_bytes: AtomicU64,
    task_count: AtomicU64,
    created_at: Instant,
}

impl Agent {
    fn new(id: String, pid: u32) -> Self {
        Self {
            id,
            pid,
            state: AtomicU32::new(AgentState::Running as u32),
            rss_bytes: AtomicU64::new(0),
            task_count: AtomicU64::new(0),
            created_at: Instant::now(),
        }
    }

    fn is_alive(&self) -> bool {
        self.state.load(Ordering::Acquire) == AgentState::Running as u32
    }

    fn check_rss_limit(&self) -> bool {
        self.rss_bytes.load(Ordering::Relaxed) < RSS_LIMIT_BYTES as u64
    }
}

#[repr(u32)]
enum AgentState {
    Running = 0,
    Terminated = 1,
}

struct Metrics {
    active_tasks: AtomicU32,
    active_agents: AtomicU32,
    queue_depths: [AtomicU32; PRIORITY_LEVELS],
    total_scheduled: AtomicU64,
    total_routed: AtomicU64,
    ipc_latency_sum_ns: AtomicU64,
    ipc_count: AtomicU64,
}

impl Metrics {
    fn new() -> Self {
        Self {
            active_tasks: AtomicU32::new(0),
            active_agents: AtomicU32::new(0),
            queue_depths: [
                AtomicU32::new(0), AtomicU32::new(0), AtomicU32::new(0), AtomicU32::new(0),
                AtomicU32::new(0), AtomicU32::new(0), AtomicU32::new(0), AtomicU32::new(0),
            ],
            total_scheduled: AtomicU64::new(0),
            total_routed: AtomicU64::new(0),
            ipc_latency_sum_ns: AtomicU64::new(0),
            ipc_count: AtomicU64::new(0),
        }
    }

    fn avg_ipc_latency_us(&self) -> f64 {
        let count = self.ipc_count.load(Ordering::Relaxed);
        if count == 0 {
            return 0.0;
        }
        let sum = self.ipc_latency_sum_ns.load(Ordering::Relaxed);
        (sum as f64 / count as f64) / 1000.0
    }
}

pub struct OrchestratorCore {
    queues: [Arc<ArrayQueue<Task>>; PRIORITY_LEVELS],
    agents: Arc<RwLock<HashMap<String, Arc<Agent>>>>,
    metrics: Arc<Metrics>,
    event_fd: AtomicU32,
    epoll_fd: AtomicU32,
    running: Arc<AtomicBool>,
    next_pid: AtomicU32,
    initialized: AtomicBool,
}

impl OrchestratorCore {
    fn new() -> Self {
        let queues = [
            Arc::new(ArrayQueue::new(QUEUE_CAPACITY)),
            Arc::new(ArrayQueue::new(QUEUE_CAPACITY)),
            Arc::new(ArrayQueue::new(QUEUE_CAPACITY)),
            Arc::new(ArrayQueue::new(QUEUE_CAPACITY)),
            Arc::new(ArrayQueue::new(QUEUE_CAPACITY)),
            Arc::new(ArrayQueue::new(QUEUE_CAPACITY)),
            Arc::new(ArrayQueue::new(QUEUE_CAPACITY)),
            Arc::new(ArrayQueue::new(QUEUE_CAPACITY)),
        ];

        Self {
            queues,
            agents: Arc::new(RwLock::new(HashMap::new())),
            metrics: Arc::new(Metrics::new()),
            event_fd: AtomicU32::new(0),
            epoll_fd: AtomicU32::new(0),
            running: Arc::new(AtomicBool::new(false)),
            next_pid: AtomicU32::new(1000),
            initialized: AtomicBool::new(false),
        }
    }

    pub fn initialize(&self) -> Result<(), String> {
        if self.initialized.swap(true, Ordering::SeqCst) {
            return Ok(());
        }

        let efd = unsafe { libc::eventfd(0, libc::EFD_NONBLOCK | libc::EFD_CLOEXEC) };
        if efd < 0 {
            return Err("Failed to create eventfd".to_string());
        }
        self.event_fd.store(efd as u32, Ordering::Release);

        let epfd = unsafe { libc::epoll_create1(libc::EPOLL_CLOEXEC) };
        if epfd < 0 {
            unsafe { libc::close(efd) };
            return Err("Failed to create epoll".to_string());
        }
        self.epoll_fd.store(epfd as u32, Ordering::Release);

        let mut event = libc::epoll_event {
            events: (libc::EPOLLIN | libc::EPOLLET) as u32,
            u64: efd as u64,
        };
        let ret = unsafe {
            libc::epoll_ctl(
                epfd,
                libc::EPOLL_CTL_ADD,
                efd,
                &mut event as *mut libc::epoll_event,
            )
        };
        if ret < 0 {
            unsafe {
                libc::close(efd);
                libc::close(epfd);
            }
            return Err("Failed to register eventfd with epoll".to_string());
        }

        self.running.store(true, Ordering::Release);
        self.spawn_reactor_thread();
        Ok(())
    }

    pub fn shutdown(&self) -> Result<(), String> {
        if !self.running.swap(false, Ordering::SeqCst) {
            return Ok(());
        }

        let efd = self.event_fd.load(Ordering::Acquire);
        let epfd = self.epoll_fd.load(Ordering::Acquire);
        
        if efd > 0 { unsafe { libc::close(efd as i32) }; }
        if epfd > 0 { unsafe { libc::close(epfd as i32) }; }

        let agent_ids: Vec<String> = self.agents.read().keys().cloned().collect();
        for agent_id in agent_ids {
            let _ = self.kill_agent(agent_id);
        }

        Ok(())
    }

    fn spawn_reactor_thread(&self) {
        let queues = self.queues.clone();
        let agents = self.agents.clone();
        let metrics = self.metrics.clone();
        let running = self.running.clone();
        let epoll_fd = self.epoll_fd.load(Ordering::Acquire) as i32;
        let event_fd = self.event_fd.load(Ordering::Acquire) as i32;

        thread::spawn(move || {
            let mut events: [libc::epoll_event; 32] = unsafe { std::mem::zeroed() };
            
            while running.load(Ordering::Acquire) {
                let nfds = unsafe {
                    libc::epoll_wait(epoll_fd, events.as_mut_ptr(), events.len() as i32, 1)
                };

                if nfds > 0 {
                    let mut buf: u64 = 0;
                    unsafe {
                        libc::read(event_fd, &mut buf as *mut u64 as *mut libc::c_void, 8);
                    }
                }

                for priority in 0..PRIORITY_LEVELS {
                    if let Some(task) = queues[priority].pop() {
                        Self::execute_task(task, &agents, &metrics);
                    }
                }
            }
        });
    }

    fn execute_task(task: Task, agents: &Arc<RwLock<HashMap<String, Arc<Agent>>>>, metrics: &Arc<Metrics>) {
        let start = Self::monotonic_ns();
        
        let agents_read = agents.read();
        let agent_opt = agents_read
            .values()
            .find(|a| Self::hash_string(&a.id) == task.agent_id_hash);

        if let Some(agent) = agent_opt {
            if agent.is_alive() && agent.check_rss_limit() {
                agent.task_count.fetch_add(1, Ordering::Relaxed);
            }
        }

        let latency = Self::monotonic_ns() - start;
        metrics.ipc_latency_sum_ns.fetch_add(latency, Ordering::Relaxed);
        metrics.ipc_count.fetch_add(1, Ordering::Relaxed);
        metrics.active_tasks.fetch_sub(1, Ordering::Relaxed);
        metrics.queue_depths[task.priority as usize].fetch_sub(1, Ordering::Relaxed);
    }

    pub fn schedule_task(&self, task_id: u64, priority: u8, agent_id_hash: u64) -> Result<u32, String> {
        if priority >= PRIORITY_LEVELS as u8 {
            return Err(format!("Invalid priority level: {}", priority));
        }

        if !self.running.load(Ordering::Acquire) {
            return Err("Orchestrator not initialized".to_string());
        }

        let task = Task {
            task_id,
            priority,
            agent_id_hash,
            enqueue_time_ns: Self::monotonic_ns(),
        };

        if self.queues[priority as usize].push(task).is_err() {
            return Err(format!("Queue {} is full", priority));
        }

        self.metrics.queue_depths[priority as usize].fetch_add(1, Ordering::Relaxed);
        self.metrics.active_tasks.fetch_add(1, Ordering::Relaxed);
        self.metrics.total_scheduled.fetch_add(1, Ordering::Relaxed);

        self.notify_reactor();
        Ok(0)
    }

    pub fn route_event(&self, event_type: u8, payload: &[u8]) -> Result<i32, String> {
        let start = Self::monotonic_ns();
        
        if payload.len() > 65536 {
            return Err("Payload too large".to_string());
        }

        let _routed = match event_type {
            0..=63 => true,
            64..=127 => true,
            128..=191 => true,
            192..=255 => true,
        };

        let latency = Self::monotonic_ns() - start;
        self.metrics.ipc_latency_sum_ns.fetch_add(latency, Ordering::Relaxed);
        self.metrics.ipc_count.fetch_add(1, Ordering::Relaxed);
        self.metrics.total_routed.fetch_add(1, Ordering::Relaxed);

        Ok(0)
    }

    pub fn spawn_agent(&self, agent_id: String) -> Result<u32, String> {
        let agents_read = self.agents.read();
        if agents_read.len() >= MAX_AGENTS {
            return Err("Maximum agents reached".to_string());
        }
        if agents_read.contains_key(&agent_id) {
            return Err(format!("Agent {} already exists", agent_id));
        }
        drop(agents_read);

        let pid = self.next_pid.fetch_add(1, Ordering::SeqCst);
        let agent = Arc::new(Agent::new(agent_id.clone(), pid));
        
        self.agents.write().insert(agent_id, agent);
        self.metrics.active_agents.fetch_add(1, Ordering::Relaxed);

        Ok(pid)
    }

    pub fn kill_agent(&self, agent_id: String) -> Result<bool, String> {
        let agent = {
            let agents_read = self.agents.read();
            agents_read.get(&agent_id).cloned()
        };

        if let Some(agent) = agent {
            agent.state.store(AgentState::Terminated as u32, Ordering::Release);
            self.agents.write().remove(&agent_id);
            self.metrics.active_agents.fetch_sub(1, Ordering::Relaxed);
            Ok(true)
        } else {
            Err(format!("Agent {} not found", agent_id))
        }
    }

    pub fn get_metrics(&self) -> Result<String, String> {
        let queue_depths: Vec<u32> = self.metrics.queue_depths
            .iter()
            .map(|d| d.load(Ordering::Relaxed))
            .collect();

        let json = format!(
            r#"{{"active_tasks":{},"active_agents":{},"queue_depth_p0_p7":[{},{},{},{},{},{},{},{}],"ipc_latency_us":{:.2},"total_scheduled":{},"total_routed":{}}}"#,
            self.metrics.active_tasks.load(Ordering::Relaxed),
            self.metrics.active_agents.load(Ordering::Relaxed),
            queue_depths[0], queue_depths[1], queue_depths[2], queue_depths[3],
            queue_depths[4], queue_depths[5], queue_depths[6], queue_depths[7],
            self.metrics.avg_ipc_latency_us(),
            self.metrics.total_scheduled.load(Ordering::Relaxed),
            self.metrics.total_routed.load(Ordering::Relaxed),
        );

        Ok(json)
    }

    fn notify_reactor(&self) {
        let efd = self.event_fd.load(Ordering::Acquire) as i32;
        if efd > 0 {
            let val: u64 = 1;
            unsafe {
                libc::write(efd, &val as *const u64 as *const libc::c_void, 8);
            }
        }
    }

    fn monotonic_ns() -> u64 {
        let mut ts = libc::timespec { tv_sec: 0, tv_nsec: 0 };
        unsafe { libc::clock_gettime(libc::CLOCK_MONOTONIC, &mut ts); }
        (ts.tv_sec as u64) * 1_000_000_000 + (ts.tv_nsec as u64)
    }

    fn hash_string(s: &str) -> u64 {
        let mut hash: u64 = 5381;
        for byte in s.bytes() {
            hash = hash.wrapping_mul(33).wrapping_add(byte as u64);
        }
        hash
    }
}

unsafe impl Send for OrchestratorCore {}
unsafe impl Sync for OrchestratorCore {}

pub static ORCHESTRATOR: Lazy<OrchestratorCore> = Lazy::new(|| {
    let core = OrchestratorCore::new();
    core.initialize().expect("Failed to initialize orchestrator");
    core
});
