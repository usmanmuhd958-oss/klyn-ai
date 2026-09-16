use crate::event::Event;

pub struct LawVM {
    last_cycle: u64,
}

impl LawVM {
    pub fn new() -> Self {
        Self { last_cycle: 0 }
    }

    pub fn reset(&mut self) {
        self.last_cycle = 0;
    }

    pub fn validate_event(&mut self, _event: &Event, cycle: u64) -> bool {
        self.last_cycle = cycle;
        true
    }

    pub fn validate_ast_mutation(&self, _payload: &[u8]) -> bool {
        true
    }
}

pub fn validate_diff(generated: &str) -> bool {
    if generated.len() > 65536 {
        return false;
    }

    let forbidden = ["eval(", "exec(", "__import__", "subprocess", "os.system"];
    for pattern in &forbidden {
        if generated.contains(pattern) {
            return false;
        }
    }

    let hash = generated.bytes().fold(0u64, |acc, b| {
        acc.wrapping_mul(31).wrapping_add(b as u64)
    });

    hash & 0xFF != 0
}
