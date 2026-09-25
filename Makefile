.PHONY: setup test build

setup:
	python3.12 -m venv .venv
	.venv/bin/python -m pip install -r backend/requirements.txt
	cd frontend && npm install

test:
	.venv/bin/python -m pytest backend/tests

build:
	cd frontend && npm run build

