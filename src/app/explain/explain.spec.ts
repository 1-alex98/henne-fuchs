import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';

import { Explain } from './explain';

describe('Explain', () => {
  let component: Explain;
  let fixture: ComponentFixture<Explain>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [Explain],
      providers: [provideRouter([])],
    })
    .compileComponents();

    fixture = TestBed.createComponent(Explain);
    component = fixture.componentInstance;
    await fixture.whenStable();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
