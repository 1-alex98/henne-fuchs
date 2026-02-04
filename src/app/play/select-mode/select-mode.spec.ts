import { ComponentFixture, TestBed } from '@angular/core/testing';

import { SelectMode } from './select-mode';

describe('SelectMode', () => {
  let component: SelectMode;
  let fixture: ComponentFixture<SelectMode>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [SelectMode]
    })
    .compileComponents();

    fixture = TestBed.createComponent(SelectMode);
    component = fixture.componentInstance;
    await fixture.whenStable();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
