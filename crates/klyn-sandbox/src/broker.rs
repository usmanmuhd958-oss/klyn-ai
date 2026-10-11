    pub fn serve(self) -> Result<(), SandboxError> {
        let (tx, rx): (Sender<UnixStream>, Receiver<UnixStream>) = bounded(self.queue_capacity);
        let mut workers = Vec::with_capacity(self.max_workers);
        for _ in 0..self.max_workers {
            let rx = rx.clone();
            let inner = Arc::clone(&self.inner);
            workers.push(std::thread::spawn(move || {
                while let Ok(stream) = rx.recv() {
                    let _ = handle_connection(stream, &inner);
                }
            }));
        }
        loop {
            match self.listener.accept() {
                Ok((stream, _)) => match tx.try_send(stream) {
                    Ok(()) => {}
                    Err(TrySendError::Full(stream)) | Err(TrySendError::Disconnected(stream)) => {
                        drop(stream);
                    }
                },
                Err(e) if e.kind() == io::ErrorKind::Interrupted => continue,
                Err(e) => return Err(SandboxError::Io(e)),
            }
        }
    }